// routes/api-tokens.js — Gestion des tokens API
const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { query }= require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

// ── Générer un token sécurisé ────────────────────────────
function generateToken() {
  const raw    = crypto.randomBytes(32).toString('hex'); // 64 chars
  const token  = `smtck_${raw}`;                         // préfixe lisible
  const prefix = token.slice(0, 13);                     // "smtck_" + 7 chars
  const hash   = crypto.createHash('sha256').update(token).digest('hex');
  return { token, prefix, hash };
}

// ── GET /api/api-tokens ───────────────────────────────────
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await query(`
      SELECT t.id, t.nom, t.description, t.token_prefix, t.actif,
             t.auto_onboard, t.permissions, t.derniere_util, t.nb_appels,
             t.created_at, t.expires_at,
             u.email AS created_by_email
      FROM api_tokens t
      LEFT JOIN users u ON t.created_by = u.id
      ORDER BY t.created_at DESC`, []);
    res.json({ success: true, tokens: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/api-tokens — créer un token ────────────────
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { nom, description, auto_onboard = true, expires_at } = req.body;
  if (!nom?.trim()) return res.status(400).json({ success: false, error: 'Nom requis' });

  const { token, prefix, hash } = generateToken();

  try {
    const result = await query(`
      INSERT INTO api_tokens (nom, description, token, token_prefix, auto_onboard, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, nom, token_prefix, created_at`,
      [nom.trim(), description || null, hash, prefix,
       auto_onboard, expires_at || null, req.user.id]
    );
    await logAction(req, 'CREATE_API_TOKEN', `token:${result.rows[0].id}`, { nom });

    // Retourner le token en clair UNE SEULE FOIS — non stocké en clair en base
    res.status(201).json({
      success : true,
      token   : token,   // ← à copier immédiatement, ne sera plus affichable
      id      : result.rows[0].id,
      nom     : result.rows[0].nom,
      prefix  : result.rows[0].token_prefix,
      created_at: result.rows[0].created_at,
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PATCH /api/api-tokens/:id — modifier un token ────────
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { nom, description, actif, auto_onboard, expires_at } = req.body;
  try {
    const result = await query(`
      UPDATE api_tokens SET
        nom          = COALESCE($1, nom),
        description  = COALESCE($2, description),
        actif        = COALESCE($3, actif),
        auto_onboard = COALESCE($4, auto_onboard),
        expires_at   = COALESCE($5, expires_at)
      WHERE id = $6
      RETURNING id, nom, token_prefix, actif, auto_onboard`,
      [nom, description, actif, auto_onboard, expires_at, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Token introuvable' });
    await logAction(req, 'UPDATE_API_TOKEN', `token:${req.params.id}`);
    res.json({ success: true, token: result.rows[0] });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/api-tokens/:id — révoquer ────────────────
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await query('UPDATE api_tokens SET actif = false WHERE id = $1', [req.params.id]);
    await logAction(req, 'REVOKE_API_TOKEN', `token:${req.params.id}`);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/api-tokens/logs ──────────────────────────────
router.get('/logs', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await query(`
      SELECT l.*, t.nom AS token_nom
      FROM api_calls_log l
      LEFT JOIN api_tokens t ON l.token_id = t.id
      ORDER BY l.created_at DESC LIMIT 100`, []);
    res.json({ success: true, logs: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Middleware d'authentification par token ───────────────
// Utilisé dans les routes /api/v1/*
async function requireApiToken(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ success: false, error: 'X-API-Key manquant' });

  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  try {
    const result = await query(
      `SELECT * FROM api_tokens WHERE token = $1 AND actif = true`, [hash]
    );
    const token = result.rows[0];
    if (!token) return res.status(401).json({ success: false, error: 'Clé API invalide ou révoquée' });

    // Vérifier expiration
    if (token.expires_at && new Date(token.expires_at) < new Date()) {
      return res.status(401).json({ success: false, error: 'Clé API expirée' });
    }

    // Mettre à jour stats
    await query(
      `UPDATE api_tokens SET derniere_util = NOW(), nb_appels = nb_appels + 1 WHERE id = $1`,
      [token.id]
    );

    req.apiToken     = token;
    req.apiTokenHash = hash;
    next();
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

module.exports = router;
module.exports.requireApiToken = requireApiToken;
