// middleware/auth.js — v2 : gestion étendue des rôles + filtrage axes
'use strict';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGEZ_CE_SECRET_EN_PRODUCTION';

// ── Hiérarchie des rôles ─────────────────────────────────────
const ROLE_LEVELS = {
  lecteur      : 1,
  banquier     : 2,
  operateur    : 3,
  supervisor   : 3,
  chef_division: 4,
  pilotage     : 5,
  directeur    : 6,
  dg           : 6,
  admin        : 9,
};

// Rôles ayant accès à la stratégie
const ROLES_STRATEGIE = ['admin','directeur','dg','pilotage','chef_division'];

// ── requireAuth ──────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ success:false, error:'Token manquant' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(err) {
    const expired = err.name === 'TokenExpiredError';
    res.status(401).json({ success:false, error: expired ? 'Token expiré' : 'Token invalide', expired });
  }
}

// ── requireRole ──────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success:false, error:'Non authentifié' });
    // Admin passe toujours
    if (req.user.role === 'admin') return next();
    // Vérification par nom de rôle exact
    if (roles.includes(req.user.role)) return next();
    // Vérification par niveau minimum
    const userLevel = ROLE_LEVELS[req.user.role] || 0;
    const minLevel  = Math.min(...roles.map(r => ROLE_LEVELS[r] || 99));
    if (userLevel >= minLevel) return next();
    res.status(403).json({ success:false, error:`Accès refusé — rôle requis : ${roles.join(' ou ')}` });
  };
}

// ── requireAxe — filtre chef_division sur ses axes ───────────
function requireAxe(axeNum) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success:false, error:'Non authentifié' });
    // Admin, directeur, pilotage, dg : accès à tous les axes
    if (['admin','directeur','pilotage','dg'].includes(req.user.role)) return next();
    // chef_division : vérifier axes_autorises
    if (req.user.role === 'chef_division') {
      const axes = req.user.axes_autorises || [];
      if (axes.includes(parseInt(axeNum))) return next();
      return res.status(403).json({ success:false, error:`Axe ${axeNum} non autorisé pour votre division` });
    }
    next();
  };
}

// ── canAccessAxe — helper frontend (dans le token) ───────────
function canAccessAxe(user, axeNum) {
  if (!user) return false;
  if (['admin','directeur','pilotage','dg'].includes(user.role)) return true;
  if (user.role === 'chef_division') {
    return (user.axes_autorises || []).includes(parseInt(axeNum));
  }
  return false;
}

// ── Tokens ───────────────────────────────────────────────────
function generateAccessToken(user) {
  return jwt.sign({
    id             : user.id,
    email          : user.email,
    role           : user.role,
    nom            : user.nom,
    prenom         : user.prenom,
    bank_code      : user.bank_code   || null,
    division       : user.division    || null,
    axes_autorises : user.axes_autorises || null,
    permissions    : user.permissions || {},
  }, JWT_SECRET, { expiresIn: '2h' });
}

function generateRefreshToken(user) {
  return jwt.sign({ id: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = {
  requireAuth, requireRole, requireAxe, canAccessAxe,
  generateAccessToken, generateRefreshToken,
  ROLE_LEVELS, ROLES_STRATEGIE,
};
