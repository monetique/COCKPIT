// middleware/auth.js — Vérification JWT sur les routes protégées
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGEZ_CE_SECRET_EN_PRODUCTION';

// ── Middleware principal : vérifie le token JWT ──────────
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token manquant' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email, role, nom, prenom }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expiré', expired: true });
    }
    return res.status(401).json({ success: false, error: 'Token invalide' });
  }
}

// ── Middleware : vérifie un rôle minimum ─────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Non authentifié' });
    }
    const ROLE_LEVELS = { lecteur: 1, operateur: 2, admin: 3 };
    const userLevel   = ROLE_LEVELS[req.user.role] || 0;
    const minLevel    = Math.min(...roles.map(r => ROLE_LEVELS[r] || 99));

    if (userLevel < minLevel) {
      return res.status(403).json({
        success: false,
        error  : `Accès refusé — rôle requis : ${roles.join(' ou ')}`
      });
    }
    next();
  };
}

// ── Générer un access token (15 min) ────────────────────
function generateAccessToken(user) {
  return jwt.sign(
    {
      id         : user.id,
      email      : user.email,
      role       : user.role,
      nom        : user.nom,
      prenom     : user.prenom,
      bank_code  : user.bank_code  || null,
      permissions: user.permissions || {},
    },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

// ── Générer un refresh token (7 jours) ──────────────────
function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = {
  requireAuth,
  requireRole,
  generateAccessToken,
  generateRefreshToken,
  JWT_SECRET
};
