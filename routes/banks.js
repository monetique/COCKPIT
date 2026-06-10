// routes/banks.js — Gestion des banques (PostgreSQL)
const express  = require('express');
const router   = express.Router();
const { query } = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

// GET /api/banks — liste toutes les banques actives
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM banks ORDER BY code::integer',
      []
    );
    res.json({ success: true, banks: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/banks/by-code?code=0520801267 — détection par affiliation
router.get('/by-code', requireAuth, async (req, res) => {
  const pid    = String(req.query.code || '').replace(/\D/g, '');
  // Essayer 2 chiffres puis 1 chiffre
  let bank = null;
  for (let len = 2; len >= 1; len--) {
    const code = pid.substring(0, len).padStart(2, '0');
    const result = await query(
      'SELECT * FROM banks WHERE code = $1 AND actif = true',
      [code]
    ).catch(() => ({ rows: [] }));
    if (result.rows[0]) { bank = result.rows[0]; break; }
  }
  res.json({ success: true, bank });
});

// POST /api/banks — créer une banque (admin)
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { code, name, email, email_cc } = req.body;
  if (!code || !name || !email) {
    return res.status(400).json({ success: false, error: 'code, name et email requis' });
  }
  if (!/^\d{1,2}$/.test(code)) {
    return res.status(400).json({ success: false, error: 'Code doit être 1 ou 2 chiffres' });
  }
  try {
    const result = await query(
      `INSERT INTO banks (code, name, email, email_cc)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [code.padStart(2, '0'), name, email, email_cc || null]
    );
    await logAction(req, 'CREATE_BANK', `bank:${code}`, { name, email, email_cc });
    res.json({ success: true, bank: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: `Code banque ${code} déjà utilisé` });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/banks/:id — modifier une banque
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, email_cc, actif } = req.body;
  try {
    const result = await query(
      `UPDATE banks SET
         name     = COALESCE($1, name),
         email    = COALESCE($2, email),
         email_cc = $5,
         actif    = COALESCE($3, actif),
         updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name, email, actif, req.params.id, email_cc !== undefined ? (email_cc || null) : null]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Banque introuvable' });
    await logAction(req, 'UPDATE_BANK', `bank:${req.params.id}`, req.body);
    res.json({ success: true, bank: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/banks/:id — désactiver (pas supprimer)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await query('UPDATE banks SET actif = false WHERE id = $1', [req.params.id]);
    await logAction(req, 'DEACTIVATE_BANK', `bank:${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
