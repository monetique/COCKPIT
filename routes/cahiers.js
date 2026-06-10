// routes/cahiers.js — Répertoire de dépôt des cahiers de recettes
const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const { requireAuth } = require('../middleware/auth');
const { logAction }   = require('../middleware/audit');

// ── Répertoire de dépôt ───────────────────────────────────
const INBOX_DIR = path.join(__dirname, '..', 'cahiers_inbox');

// Créer le répertoire s'il n'existe pas
if (!fs.existsSync(INBOX_DIR)) {
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  console.log('📁 Répertoire créé :', INBOX_DIR);
}

// ── Config multer ─────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, INBOX_DIR),
  filename   : (req, file, cb) => {
    // Préfixer avec timestamp pour éviter les collisions
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\-()[\] ]/g, '_');
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    cb(null, `${ts}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits   : { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel')
        || file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers .xlsx et .xls sont acceptés'));
    }
  },
});

// ── GET /api/cahiers — liste les fichiers ─────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const rawFiles = fs.readdirSync(INBOX_DIR)
      .filter(f => f.match(/\.(xlsx|xls)$/i))
      .map(filename => {
        const fullPath = path.join(INBOX_DIR, filename);
        const stat     = fs.statSync(fullPath);
        const originalName = filename.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_/, '');
        // Essayer d'extraire le processing_id depuis le nom de fichier
        const pidMatch = originalName.match(/_(\d{7,15})[_.]/) || originalName.match(/(\d{7,15})/);
        return {
          filename,
          originalName,
          size           : stat.size,
          uploadedAt     : stat.mtime.toISOString(),
          sizeKB         : Math.round(stat.size / 1024),
          processing_id  : pidMatch ? pidMatch[1] : null,
        };
      })
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    // Enrichir avec les statuts marchands
    let files = rawFiles;
    try {
      const { query } = require('../db/postgres');
      const pids = [...new Set(rawFiles.map(f => f.processing_id).filter(Boolean))];
      if (pids.length > 0) {
        const ph   = pids.map((_, i) => `$${i+1}`).join(',');
        const mRes = await query(
          `SELECT processing_id, raison_sociale, statut FROM merchants_tracking WHERE processing_id IN (${ph})`,
          pids
        );
        const mMap = {};
        mRes.rows.forEach(r => { mMap[r.processing_id] = r; });
        files = rawFiles.map(f => ({
          ...f,
          merchant: f.processing_id ? (mMap[f.processing_id] || null) : null,
        }));
      }
    } catch(e) {
      console.warn('[cahiers] enrichissement:', e.message);
    }

    res.json({ success: true, files, total: files.length, dir: INBOX_DIR });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/cahiers/mark-received — marquage manuel ─────
// Marque un marchand comme recettes_recues sans passer par l'upload
router.post('/mark-received', requireAuth, async (req, res) => {
  const { processing_id } = req.body;
  if (!processing_id) return res.status(400).json({ success: false, error: 'processing_id requis' });
  try {
    const { query } = require('../db/postgres');
    const result = await query(
      `UPDATE merchants_tracking
       SET statut = 'recettes_recues',
           date_reception_recettes = COALESCE(date_reception_recettes, NOW()),
           updated_at = NOW()
       WHERE processing_id = $1
         AND statut IN ('recettes_envoyees','prise_en_charge','en_attente')
       RETURNING processing_id, raison_sociale, statut`,
      [processing_id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Dossier introuvable ou statut incompatible' });
    }
    const { logAction } = require('../middleware/audit');
    await logAction(req, 'RECETTES_RECUES', `merchant:${processing_id}`, { source: 'manual' });
    console.log(`📬 Recettes reçues (manuel) : ${processing_id}`);
    res.json({ success: true, merchant: result.rows[0] });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Extraction processing_id depuis un fichier Excel ──────
// Lit la feuille "Informations" et cherche la ligne "Processing ID"
function extractProcessingId(filePath) {
  try {
    const XLSX   = require('xlsx');
    const wb     = XLSX.readFile(filePath);
    const ws     = wb.Sheets['Informations'];
    if (!ws) return null;
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    for (const row of data) {
      const label = String(row[1] || '').toLowerCase();
      if (label.includes('processing id') || label.includes('processing_id')) {
        const val = String(row[2] || '').trim();
        if (val && val.length >= 5 && !val.startsWith('{{')) return val;
      }
    }
    return null;
  } catch(e) {
    console.warn('[cahiers] extractProcessingId:', e.message);
    return null;
  }
}

// ── POST /api/cahiers/upload — déposer un fichier ─────────
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Fichier manquant' });

  const originalName = req.file.originalname.replace(/[^a-zA-Z0-9._\-()[\] ]/g, '_');

  // ── Extraire le processing_id depuis le fichier Excel ────
  const processingId = extractProcessingId(req.file.path);
  let merchantInfo   = null;
  let autoMarked     = false;

  if (processingId) {
    try {
      const { query } = require('../db/postgres');

      // Récupérer les infos du marchand
      const mRes = await query(
        `SELECT processing_id, raison_sociale, statut FROM merchants_tracking WHERE processing_id = $1`,
        [processingId]
      );
      if (mRes.rows[0]) {
        merchantInfo = mRes.rows[0];

        // Marquer automatiquement recettes_recues si le dossier est en recettes_envoyees
        if (merchantInfo.statut === 'recettes_envoyees') {
          await query(
            `UPDATE merchants_tracking
             SET statut = 'recettes_recues',
                 date_reception_recettes = NOW(),
                 updated_at = NOW()
             WHERE processing_id = $1`,
            [processingId]
          );
          autoMarked = true;
          merchantInfo.statut = 'recettes_recues';
          console.log(`📥 Cahier reçu → ${processingId} (${merchantInfo.raison_sociale}) — statut → recettes_recues`);
        }
      }
    } catch(e) {
      console.warn('[cahiers] Mise à jour statut:', e.message);
    }
  }

  await logAction(req, 'CAHIER_DEPOSE', 'cahiers_inbox', {
    filename     : req.file.filename,
    size         : req.file.size,
    processing_id: processingId || null,
    auto_marked  : autoMarked,
  });

  console.log(`📥 Cahier déposé : ${req.file.filename} (${Math.round(req.file.size/1024)} KB)${processingId ? ` — PID: ${processingId}` : ''}`);
  res.json({
    success      : true,
    filename     : req.file.filename,
    originalName : originalName,
    size         : req.file.size,
    sizeKB       : Math.round(req.file.size / 1024),
    uploadedAt   : new Date().toISOString(),
    processing_id: processingId  || null,
    merchant     : merchantInfo  || null,
    auto_marked  : autoMarked,
  });
});

// ── GET /api/cahiers/download/:filename — télécharger ─────
router.get('/download/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // sécurité : pas de path traversal
  const fullPath = path.join(INBOX_DIR, filename);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ success: false, error: 'Fichier introuvable' });
  }

  const originalName = filename.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_/, '');
  res.download(fullPath, originalName);
});

// ── GET /api/cahiers/read/:filename — lire le contenu ─────
// Retourne le fichier en base64 pour analyse côté client
router.get('/read/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const fullPath = path.join(INBOX_DIR, filename);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ success: false, error: 'Fichier introuvable' });
  }

  try {
    const buffer   = fs.readFileSync(fullPath);
    const base64   = buffer.toString('base64');
    const original = filename.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_/, '');
    res.json({ success: true, base64, filename: original });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/cahiers/:filename — supprimer ─────────────
router.delete('/:filename', requireAuth, async (req, res) => {
  const filename = path.basename(req.params.filename);
  const fullPath = path.join(INBOX_DIR, filename);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ success: false, error: 'Fichier introuvable' });
  }

  try {
    fs.unlinkSync(fullPath);
    await logAction(req, 'CAHIER_SUPPRIME', 'cahiers_inbox', { filename });
    console.log(`🗑️  Cahier supprimé : ${filename}`);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.INBOX_DIR = INBOX_DIR;
