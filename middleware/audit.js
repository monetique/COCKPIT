// middleware/audit.js — Actions utilisateurs : PostgreSQL + fichier log
'use strict';

const { query }         = require('../db/postgres');
const { logUserAction } = require('../config/logger');

async function logAction(req, action, resource, details = {}) {
  const user  = req?.user?.email || req?.user?.id || 'systeme';
  const ip    = req?.ip          || null;
  const userId= req?.user?.id    || null;

  // 1. PostgreSQL (audit_log)
  try {
    await query(
      `INSERT INTO audit_log (user_id, user_email, action, resource, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, user, action, resource || null, JSON.stringify(details), ip]
    );
  } catch (err) {
    try {
      const { logger } = require('../config/logger');
      logger.warn('Erreur audit_log PostgreSQL', { error: err.message, action, resource });
    } catch {}
  }

  // 2. Fichier log structure
  try {
    logUserAction(action, { user, ip, resource, details });
  } catch {}
}

module.exports = { logAction };
