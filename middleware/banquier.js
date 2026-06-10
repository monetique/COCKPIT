// middleware/banquier.js
// Middleware d'étanchéité des données par banque
// Filtre automatiquement les requêtes pour les utilisateurs rôle "banquier"
'use strict';

/**
 * Middleware qui injecte le filtre banque dans req.bankFilter
 * Pour les admins/supervisors : pas de filtre (accès total)
 * Pour les banquiers : filtre sur les 2 premiers chars du processing_id
 */
function bankFilter(req, res, next) {
  const user = req.user;
  if (!user) return res.status(401).json({ success: false, error: 'Non authentifié' });

  if (user.role === 'banquier' && user.bank_code) {
    req.bankFilter = {
      code      : user.bank_code.padStart(2, '0'),
      sqlWhere  : `SUBSTRING(mt.processing_id, 1, 2) = '${user.bank_code.padStart(2, '0')}'`,
      pgParam   : user.bank_code.padStart(2, '0'),
      isBanquier: true,
    };
  } else {
    req.bankFilter = { isBanquier: false, code: null, sqlWhere: null };
  }
  next();
}

/**
 * Middleware qui vérifie qu'un banquier n'accède qu'à SES marchands
 * Utiliser sur les routes prenant un processing_id en paramètre
 */
async function enforceBankAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Non authentifié' });
  if (req.user.role !== 'banquier') return next(); // admin/supervisor passent

  const pid  = req.params.processing_id || req.body?.processingId || req.query?.processing_id;
  const code = (req.user.bank_code || '').padStart(2, '0');

  if (!pid) return next();

  if (!String(pid).startsWith(code)) {
    return res.status(403).json({
      success: false,
      error  : 'Accès refusé — ce marchand n\'appartient pas à votre banque',
    });
  }
  next();
}

/**
 * Middleware qui vérifie une permission granulaire pour les banquiers
 * ex: requirePermission('can_upload_cahier')
 */
function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Non authentifié' });

    // Admin et supervisor ont toujours accès
    if (['admin', 'supervisor'].includes(req.user.role)) return next();

    // Banquier : vérifier la permission
    if (req.user.role === 'banquier') {
      const perms = req.user.permissions || {};
      if (perms[perm] === true) return next();
      return res.status(403).json({
        success: false,
        error  : `Permission insuffisante — "${perm}" non accordée par l'administrateur`,
      });
    }

    return res.status(403).json({ success: false, error: 'Accès refusé' });
  };
}

/**
 * Middleware qui bloque complètement l'accès aux banquiers
 * Pour les routes réservées admin/supervisor
 */
function denyBanquier(req, res, next) {
  if (req.user?.role === 'banquier') {
    return res.status(403).json({
      success: false,
      error  : 'Accès réservé aux administrateurs',
    });
  }
  next();
}

module.exports = { bankFilter, enforceBankAccess, requirePermission, denyBanquier };
