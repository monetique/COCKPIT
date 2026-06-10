// config/email-logger.js — Enregistrement de tous les emails dans PostgreSQL
const { query } = require('../db/postgres');

async function logEmail({ type, processing_id, to, cc, subject, status, error, user_id }) {
  try {
    await query(
      `INSERT INTO emails_log (type, processing_id, to_email, cc_emails, subject, status, error_msg, envoye_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        type,
        processing_id || null,
        to,
        cc     || null,
        subject || null,
        status  || 'sent',
        error  || null,
        user_id || null
      ]
    );
  } catch (err) {
    console.warn('⚠️ Erreur email_log:', err.message);
  }
}

module.exports = { logEmail };
