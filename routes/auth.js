// routes/auth.js — Authentification JWT
const express  = require('express');
const bcrypt   = require('bcrypt');
const crypto   = require('crypto');
const router   = express.Router();
const { query } = require('../db/postgres');
const {
  requireAuth, requireRole,
  generateAccessToken, generateRefreshToken
} = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

const BCRYPT_ROUNDS = 12;

// ── POST /api/auth/login ─────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email et mot de passe requis' });
  }

  try {
    const result = await query(
      'SELECT * FROM users WHERE email = $1 AND actif = true',
      [email.toLowerCase().trim()]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ success: false, error: 'Identifiants invalides' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Identifiants invalides' });
    }

    // Générer les tokens
    const accessToken  = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    const tokenHash    = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Sauvegarder le refresh token
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, tokenHash]
    );

    // Mettre à jour la date de dernière connexion
    await query(
      'UPDATE users SET derniere_connexion = NOW() WHERE id = $1',
      [user.id]
    );

    await logAction(req, 'LOGIN', `user:${user.id}`, { email: user.email });

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id         : user.id,
        nom        : user.nom,
        prenom     : user.prenom,
        email      : user.email,
        role       : user.role,
        bank_code  : user.bank_code   || null,
        permissions: user.permissions || {},
      }
    });
  } catch (err) {
    console.error('Erreur login:', err.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ── POST /api/auth/refresh ───────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, error: 'Refresh token manquant' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth');
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    if (decoded.type !== 'refresh') throw new Error('Type invalide');

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const result = await query(
      `SELECT rt.*, u.id as uid, u.nom, u.prenom, u.email, u.role, u.actif,
              u.bank_code, u.permissions
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token_hash = $1 AND rt.revoked = false AND rt.expires_at > NOW()`,
      [tokenHash]
    );

    const row = result.rows[0];
    if (!row || !row.actif) {
      return res.status(401).json({ success: false, error: 'Refresh token invalide ou expiré' });
    }

    const newAccessToken = generateAccessToken({
      id         : row.uid,
      nom        : row.nom,
      prenom     : row.prenom,
      email      : row.email,
      role       : row.role,
      bank_code  : row.bank_code   || null,
      permissions: row.permissions || {},
    });

    res.json({ success: true, accessToken: newAccessToken });
  } catch (err) {
    res.status(401).json({ success: false, error: 'Refresh token invalide', expired: true });
  }
});

// ── POST /api/auth/logout ────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await query(
      'UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1',
      [tokenHash]
    ).catch(() => {});
  }
  await logAction(req, 'LOGOUT', `user:${req.user.id}`);
  res.json({ success: true });
});

// ── GET /api/auth/me ─────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, nom, prenom, email, role, derniere_connexion FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'Utilisateur introuvable' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/auth/change-password ──────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Mots de passe requis' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Mot de passe trop court (min 8 caractères)' });
  }

  try {
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid  = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(400).json({ success: false, error: 'Mot de passe actuel incorrect' });

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
    await logAction(req, 'CHANGE_PASSWORD', `user:${req.user.id}`);
    res.json({ success: true, message: 'Mot de passe modifié' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
//  GESTION DES UTILISATEURS (admin uniquement)
// ──────────────────────────────────────────────────────────

// GET /api/auth/users — liste tous les utilisateurs
router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await query(
      `SELECT id, nom, prenom, email, role, actif, derniere_connexion, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auth/users — créer un utilisateur
router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { nom, prenom, email, password, role, bank_code, permissions } = req.body;
  if (!nom || !prenom || !email || !password) {
    return res.status(400).json({ success: false, error: 'Champs obligatoires manquants' });
  }

  try {
    const hash   = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await query(
      `INSERT INTO users (nom, prenom, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nom, prenom, email, role, created_at`,
      [nom, prenom, email.toLowerCase().trim(), hash, role || 'operateur']
    );
    await logAction(req, 'CREATE_USER', `user:${result.rows[0].id}`, { email });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Email déjà utilisé' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/auth/users/:id — modifier un utilisateur
router.patch('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { nom, prenom, email, role, actif, bank_code, permissions } = req.body;
  try {
    const result = await query(
      `UPDATE users SET
         nom    = COALESCE($1, nom),
         prenom = COALESCE($2, prenom),
         email  = COALESCE($3, email),
         role        = COALESCE($4, role),
         actif       = COALESCE($5, actif),
         bank_code   = COALESCE($7, bank_code),
         permissions = COALESCE($8::jsonb, permissions)
       WHERE id = $6
       RETURNING id, nom, prenom, email, role, actif, bank_code, permissions`,
      [nom, prenom, email?.toLowerCase().trim(), role, actif, req.params.id,
       bank_code !== undefined ? (bank_code || null) : undefined,
       permissions !== undefined ? JSON.stringify(permissions) : undefined]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Utilisateur introuvable' });
    await logAction(req, 'UPDATE_USER', `user:${req.params.id}`, req.body);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auth/users/:id/reset-password — admin reset
router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Mot de passe invalide (min 8 caractères)' });
  }
  try {
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    await logAction(req, 'RESET_PASSWORD', `user:${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
