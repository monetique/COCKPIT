// routes/users.js — Gestion complète des utilisateurs
'use strict';
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcrypt');
const { query }    = require('../db/postgres');
const { requireAuth, requireRole, logAction } = require('../middleware/auth');
const { logAction: log } = require('../middleware/audit');

const BCRYPT_ROUNDS = 12;

const ROLES_VALIDES = [
  'admin','directeur','chef_division','pilotage',
  'operateur','supervisor','lecteur','dg','banquier'
];

const DIVISIONS = ['systemes','canaux'];

// ── GET /api/users — liste ───────────────────────────────────
router.get('/', requireAuth, requireRole('admin','directeur'), async (req, res) => {
  try {
    const r = await query(`
      SELECT id, nom, prenom, email, role, actif, division,
             axes_autorises, bank_code, derniere_connexion, created_at
      FROM users ORDER BY role, nom`, []
    );
    res.json({ success:true, users: r.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/users/:id ───────────────────────────────────────
router.get('/:id', requireAuth, requireRole('admin','directeur'), async (req, res) => {
  try {
    const r = await query(
      `SELECT id, nom, prenom, email, role, actif, division,
              axes_autorises, bank_code, derniere_connexion, created_at
       FROM users WHERE id=$1`, [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success:false, error:'Introuvable' });
    res.json({ success:true, user: r.rows[0] });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── POST /api/users — créer ──────────────────────────────────
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { nom, prenom, email, password, role, bank_code,
          division, axes_autorises } = req.body;

  if (!nom || !prenom || !email || !password)
    return res.status(400).json({ success:false, error:'Champs obligatoires : nom, prenom, email, password' });
  if (role && !ROLES_VALIDES.includes(role))
    return res.status(400).json({ success:false, error:`Rôle invalide : ${role}` });
  if (division && !DIVISIONS.includes(division))
    return res.status(400).json({ success:false, error:`Division invalide : ${division}` });

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const r = await query(`
      INSERT INTO users (nom, prenom, email, password_hash, role, bank_code, division, axes_autorises)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, nom, prenom, email, role, actif, division, axes_autorises, created_at`,
      [nom, prenom, email.toLowerCase().trim(), hash,
       role || 'operateur', bank_code || null,
       division || null,
       axes_autorises ? axes_autorises : null]
    );
    await log(req, 'CREATE_USER', `user:${r.rows[0].id}`, { email, role });
    res.status(201).json({ success:true, user: r.rows[0] });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ success:false, error:'Email déjà utilisé' });
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── PATCH /api/users/:id — modifier ─────────────────────────
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { nom, prenom, email, role, actif, bank_code,
          division, axes_autorises, password } = req.body;

  if (role && !ROLES_VALIDES.includes(role))
    return res.status(400).json({ success:false, error:`Rôle invalide : ${role}` });

  try {
    // Hash nouveau mot de passe si fourni
    let pwHash = undefined;
    if (password) pwHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const r = await query(`
      UPDATE users SET
        nom            = COALESCE($1, nom),
        prenom         = COALESCE($2, prenom),
        email          = COALESCE($3, email),
        role           = COALESCE($4, role),
        actif          = COALESCE($5, actif),
        bank_code      = COALESCE($6, bank_code),
        division       = COALESCE($7, division),
        axes_autorises = COALESCE($8, axes_autorises),
        password_hash  = COALESCE($9, password_hash),
        updated_at     = NOW()
      WHERE id = $10
      RETURNING id, nom, prenom, email, role, actif,
                division, axes_autorises, bank_code`,
      [nom||null, prenom||null,
       email ? email.toLowerCase().trim() : null,
       role||null, actif !== undefined ? actif : null,
       bank_code !== undefined ? (bank_code||null) : null,
       division !== undefined ? (division||null) : null,
       axes_autorises !== undefined ? axes_autorises : null,
       pwHash || null,
       req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success:false, error:'Introuvable' });
    await log(req, 'UPDATE_USER', `user:${req.params.id}`, { role, division, axes_autorises });
    res.json({ success:true, user: r.rows[0] });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── DELETE /api/users/:id — désactiver (soft delete) ─────────
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ success:false, error:'Impossible de se désactiver soi-même' });
  try {
    await query(`UPDATE users SET actif=false, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await log(req, 'DEACTIVATE_USER', `user:${req.params.id}`, {});
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

module.exports = router;
