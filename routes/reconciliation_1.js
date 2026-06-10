// routes/reconciliation.js — Réconciliation fichiers Ministère vs CTP/Paysmart
const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const Papa       = require('papaparse');
const fs         = require('fs');
const path       = require('path');
const oracledb   = require('oracledb');
const { query }  = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

const upload = multer({ dest: '/tmp/recon_uploads/', limits: { fileSize: 10*1024*1024 } });

// ── POST /api/reconciliation/upload ─────────────────────
router.post('/upload', requireAuth, requireRole('admin'),
  upload.array('fichiers', 31), async (req, res) => {
  const results = [];
  for (const file of req.files) {
    try {
      // Parser le CSV
      const content = fs.readFileSync(file.path, 'utf8');
      const parsed  = Papa.parse(content, {
        header: true, delimiter: ';', skipEmptyLines: true,
        transformHeader: h => h.trim().toLowerCase()
          .replace('autorisation','autorisation')
          .replace('id eleve','id_eleve')
          .replace('sessioncnte','session_cnte')
          .replace('typepaiement','type_paiement'),
      });
      fs.unlinkSync(file.path);

      if (!parsed.data.length) {
        results.push({ fichier: file.originalname, erreur: 'Fichier vide' });
        continue;
      }

      // Extraire la date du fichier depuis la première ligne
      const firstRow   = parsed.data[0];
      const dateStr    = (firstRow.date || '').slice(0,10);
      const dateFichier = dateStr || new Date().toISOString().slice(0,10);

      // Créer le fichier en base
      const fichierRes = await query(
        `INSERT INTO recon_fichiers (nom_fichier, date_fichier, nb_lignes, statut, uploaded_by)
         VALUES ($1, $2, $3, 'en_cours', $4) RETURNING id`,
        [file.originalname, dateFichier, parsed.data.length, req.user.id]
      );
      const fichierId = fichierRes.rows[0].id;

      // Insérer les lignes
      for (const row of parsed.data) {
        await query(
          `INSERT INTO recon_ministere
           (fichier_id, autorisation, date_paiement, id_eleve, montant, session_cnte, type_paiement)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            fichierId,
            (row.autorisation||'').trim(),
            row.date ? new Date(row.date) : null,
            (row.id_eleve||'').trim(),
            parseFloat(row.montant||0),
            (row.session_cnte||'').trim(),
            (row.type_paiement||'').trim(),
          ]
        ).catch(() => {});
      }

      // Lancer la réconciliation
      const recon = await reconcilier(fichierId, dateFichier, req);

      await query(
        `UPDATE recon_fichiers SET statut='termine', nb_lignes=$1 WHERE id=$2`,
        [parsed.data.length, fichierId]
      );

      results.push({
        fichier   : file.originalname,
        date      : dateFichier,
        lignes    : parsed.data.length,
        ...recon,
      });

    } catch(e) {
      results.push({ fichier: file.originalname, erreur: e.message });
    }
  }
  await logAction(req, 'RECON_UPLOAD', 'reconciliation', { fichiers: results.length });
  res.json({ success: true, results });
});

// ── Fonction réconciliation ──────────────────────────────
async function reconcilier(fichierId, dateFichier, req) {
  // Récupérer les lignes Ministère
  const ministereRes = await query(
    `SELECT id, autorisation, date_paiement, montant FROM recon_ministere WHERE fichier_id=$1`,
    [fichierId]
  );
  const lignes = ministereRes.rows;
  if (!lignes.length) return { reconcilies:0, non_reconcilies:0 };

  const dateD = dateFichier + ' 00:00:00';
  const dateF = dateFichier + ' 23:59:59';

  // ── 1. Charger les paiements CTP (Oracle) ───────────
  let ctpMap = {};
  try {
    const oConn = await oracledb.getConnection('bpc');
    const r = await oConn.execute(
      `SELECT ORDERNUMBER, ACTION_CODE_INT, AMOUNT, TRANS_DATE, PAYMENT_STATE
       FROM BPCTRANSACTIONS T
       WHERE T.PROCESSING_ID = '0383026168'
         AND T.TRANS_DATE >= TO_DATE(:dd,'YYYY-MM-DD HH24:MI:SS')
         AND T.TRANS_DATE <= TO_DATE(:df,'YYYY-MM-DD HH24:MI:SS')`,
      { dd: dateD, df: dateF },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    await oConn.close();
    r.rows.forEach(row => {
      // Clé = numéro d'autorisation (ACTION_CODE_INT ou ORDERNUMBER)
      const key = String(row.ORDERNUMBER || '').trim();
      if (key) ctpMap[key] = { source:'ctp', state: row.PAYMENT_STATE, amount: row.AMOUNT };
    });
  } catch(e) { console.warn('[recon] Oracle:', e.message); }

  // ── 2. Charger les paiements Paysmart (SQL Server) ──
  let psmMap = {};
  try {
    const pool = req.sqlPool;
    if (pool) {
      const r = await pool.request().query(`
        SELECT [reference], [Reference Autorisation], [Montant], [Etat], [Date]
        FROM [switchdb].[dbo].[TO_QLIK_BI_new]
        WHERE [Facturier] = 'CNTE'
          AND CONVERT(date,[Date],103) = CONVERT(date,'${dateFichier}',23)`);
      r.recordset.forEach(row => {
        const key = String(row['Reference Autorisation'] || row['reference'] || '').trim();
        if (key) psmMap[key] = { source:'paysmart', etat: row['Etat'], montant: row['Montant'] };
      });
    }
  } catch(e) { console.warn('[recon] Paysmart:', e.message); }

  // ── 3. Réconciliation ligne par ligne ────────────────
  let reconcilies = 0, non_reconcilies = 0;

  for (const ligne of lignes) {
    const autorisation = (ligne.autorisation || '').trim();
    let statut = 'non_reconcilie';
    let source = null;

    // Chercher dans CTP
    if (ctpMap[autorisation]) {
      statut = 'reconcilie_ctp';
      source = 'ctp';
      reconcilies++;
    }
    // Chercher dans Paysmart
    else if (psmMap[autorisation]) {
      statut = 'reconcilie_paysmart';
      source = 'paysmart';
      reconcilies++;
    }
    else {
      non_reconcilies++;
    }

    await query(
      `UPDATE recon_ministere SET statut_recon=$1, source_trouvee=$2 WHERE id=$3`,
      [statut, source, ligne.id]
    ).catch(() => {});
  }

  return { reconcilies, non_reconcilies, taux: Math.round(reconcilies/lignes.length*100) };
}

// ── GET /api/reconciliation/fichiers ────────────────────
router.get('/fichiers', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT f.*, u.nom, u.prenom,
              COUNT(m.id) AS total,
              COUNT(CASE WHEN m.statut_recon LIKE 'reconcilie%' THEN 1 END) AS reconcilies,
              COUNT(CASE WHEN m.statut_recon = 'non_reconcilie' THEN 1 END) AS non_reconcilies
       FROM recon_fichiers f
       LEFT JOIN users u ON f.uploaded_by = u.id
       LEFT JOIN recon_ministere m ON m.fichier_id = f.id
       GROUP BY f.id, u.nom, u.prenom
       ORDER BY f.date_fichier DESC`,
      []
    );
    res.json({ success: true, fichiers: r.rows });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/reconciliation/:id/ecarts ──────────────────
router.get('/:id/ecarts', requireAuth, requireRole('admin'), async (req, res) => {
  const { statut, page=1, limit=100 } = req.query;
  const offset = (page-1)*limit;
  try {
    let where = 'WHERE fichier_id=$1';
    const params = [req.params.id];
    if (statut) { params.push(statut); where += ` AND statut_recon=$${params.length}`; }

    const r = await query(
      `SELECT * FROM recon_ministere ${where}
       ORDER BY date_paiement, autorisation
       LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, limit, offset]
    );
    const count = await query(
      `SELECT COUNT(*) FROM recon_ministere ${where}`, params
    );
    res.json({ success:true, lignes:r.rows, total:parseInt(count.rows[0].count) });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── GET /api/reconciliation/:id/export ──────────────────
router.get('/:id/export', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT autorisation, to_char(date_paiement,'DD/MM/YYYY HH24:MI') AS date_paiement,
              id_eleve, montant, session_cnte, type_paiement,
              statut_recon, source_trouvee
       FROM recon_ministere WHERE fichier_id=$1 ORDER BY statut_recon, date_paiement`,
      [req.params.id]
    );
    const XLSX = require('xlsx');
    const ws   = XLSX.utils.json_to_sheet(r.rows);
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Réconciliation');
    const buf  = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
    res.set({
      'Content-Type'       : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Reconciliation_${req.params.id.slice(0,8)}.xlsx"`,
    });
    res.send(buf);
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── GET /api/reconciliation/:id/stats ───────────────────
router.get('/:id/stats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT
         COUNT(*) AS total,
         COUNT(CASE WHEN statut_recon LIKE 'reconcilie%' THEN 1 END) AS reconcilies,
         COUNT(CASE WHEN statut_recon = 'non_reconcilie' THEN 1 END) AS non_reconcilies,
         COUNT(CASE WHEN statut_recon = 'reconcilie_ctp' THEN 1 END) AS via_ctp,
         COUNT(CASE WHEN statut_recon = 'reconcilie_paysmart' THEN 1 END) AS via_paysmart,
         SUM(montant) AS montant_total,
         SUM(CASE WHEN statut_recon LIKE 'reconcilie%' THEN montant ELSE 0 END) AS montant_reconcilie
       FROM recon_ministere WHERE fichier_id=$1`,
      [req.params.id]
    );
    const row = r.rows[0];
    res.json({ success:true, stats:{
      total           : parseInt(row.total),
      reconcilies     : parseInt(row.reconcilies),
      non_reconcilies : parseInt(row.non_reconcilies),
      via_ctp         : parseInt(row.via_ctp),
      via_paysmart    : parseInt(row.via_paysmart),
      taux            : row.total > 0 ? Math.round(row.reconcilies/row.total*100) : 0,
      montant_total   : parseFloat(row.montant_total||0),
      montant_reconcilie : parseFloat(row.montant_reconcilie||0),
    }});
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

module.exports = router;
