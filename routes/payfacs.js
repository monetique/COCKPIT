// routes/payfacs.js — CRUD PAYFACs
const express  = require('express');
const router   = express.Router();
const { query }= require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

// GET /api/payfacs
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await query(`
      SELECT p.*, b.name AS bank_name, b.email AS bank_email
      FROM payfacs p LEFT JOIN banks b ON p.bank_id = b.id
      ORDER BY p.nom`, []);
    res.json({ success:true, payfacs: r.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// POST /api/payfacs
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { identifiant, nom, responsable, webmaster, bank_id, telephone, actif=true } = req.body;
  if (!identifiant || !nom) return res.status(400).json({ success:false, error:'identifiant et nom requis' });
  try {
    const r = await query(`
      INSERT INTO payfacs (identifiant,nom,responsable,webmaster,bank_id,telephone,actif)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [identifiant,nom,responsable||null,webmaster||null,bank_id||null,telephone||null,actif]);
    await logAction(req,'CREATE_PAYFAC',`payfac:${r.rows[0].id}`,{nom});
    res.status(201).json({ success:true, payfac: r.rows[0] });
  } catch(e) {
    if (e.code==='23505') return res.status(409).json({ success:false, error:`Identifiant ${identifiant} déjà utilisé` });
    res.status(500).json({ success:false, error:e.message });
  }
});

// PATCH /api/payfacs/:id
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { identifiant, nom, responsable, webmaster, bank_id, telephone, actif } = req.body;
  try {
    const r = await query(`
      UPDATE payfacs SET
        identifiant = COALESCE($1,identifiant),
        nom         = COALESCE($2,nom),
        responsable = COALESCE($3,responsable),
        webmaster   = COALESCE($4,webmaster),
        bank_id     = COALESCE($5,bank_id),
        telephone   = COALESCE($6,telephone),
        actif       = COALESCE($7,actif),
        updated_at  = NOW()
      WHERE id=$8 RETURNING *`,
      [identifiant,nom,responsable,webmaster,bank_id,telephone,actif,req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success:false, error:'PAYFAC introuvable' });
    await logAction(req,'UPDATE_PAYFAC',`payfac:${req.params.id}`);
    res.json({ success:true, payfac: r.rows[0] });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// DELETE /api/payfacs/:id
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await query('UPDATE payfacs SET actif=false WHERE id=$1',[req.params.id]);
    await logAction(req,'DELETE_PAYFAC',`payfac:${req.params.id}`);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

module.exports = router;
