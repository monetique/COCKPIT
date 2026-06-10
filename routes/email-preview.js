// routes/email-preview.js — Envoi d'échantillons email pour vérification
'use strict';
const express   = require('express');
const router    = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail, getCcList }      = require('../config/mailer');
const { logAction }                = require('../middleware/audit');

// ── POST /api/email-preview/send ─────────────────────────
// Génère tous les templates avec les données du marchand de démo
// et les envoie à l'adresse fournie
router.post('/send', requireAuth, requireRole('admin'), async (req, res) => {
  const { to, processing_id } = req.body;

  if (!to)            return res.status(400).json({ success: false, error: 'Email destinataire requis' });
  if (!processing_id) return res.status(400).json({ success: false, error: 'processing_id requis' });

  const pgDb = require('../db/postgres');

  // ── Charger le marchand exemple depuis la DB ──────────
  let dossier = null;
  try {
    const r = await pgDb.query(
      `SELECT mt.*, b.name AS bank_name, b.email AS bank_email
       FROM merchants_tracking mt
       LEFT JOIN banks b ON SUBSTRING(mt.processing_id,1,2)=LPAD(b.code::text,2,'0') AND b.actif=true
       WHERE mt.processing_id = $1`, [processing_id]
    );
    dossier = r.rows[0] || null;
  } catch(e) {
    console.warn('[email-preview] Chargement dossier:', e.message);
  }

  if (!dossier) {
    return res.status(404).json({
      success: false,
      error: `Marchand introuvable : ${processing_id}. Vérifiez le processing_id dans la base locale.`
    });
  }

  // ── Construire les données de démonstration ───────────
  const {
    generateRef,
    generateTestCredentials,
    buildEmailHTML,
    buildCahierRecettes,
  } = require('../config/email-prise-en-charge');

  const generatePassword = () =>
    Math.random().toString(36).slice(2, 9).toUpperCase() +
    Math.random().toString(36).slice(2, 5);

  const pid         = dossier.processing_id;
  const refTest     = dossier.tracking_ref_test || generateRef(pid);
  const refProd     = `CTP-PROD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${pid.slice(-4).toUpperCase()}-DEMO`;
  const terminalId  = dossier.terminal_id || '';
  const creds       = generateTestCredentials(pid, terminalId);

  const merchantObj = {
    processing_id : pid,
    raison_sociale: dossier.raison_sociale,
    terminal_id   : terminalId,
    mcc           : dossier.mcc           || '',
    email_contact : to,                        // envoi vers l'adresse de preview
    site_web      : (() => {
      const v = dossier.site_url || dossier.site_web || '';
      return (v && !v.includes('@')) ? v : '';
    })(),
  };

  const merchantInfo = {
    raisonSociale: dossier.raison_sociale,
    processingId : pid,
    terminalId   : terminalId || '—',
    siteUrl      : (() => {
      const v = dossier.site_url || dossier.site_web || '';
      return (v && !v.includes('@')) ? v : '—';
    })(),
  };

  const prodApiUser = (terminalId && terminalId.trim()) ? terminalId.trim() : pid;
  const prodCreds = {
    trackingRef  : refProd,
    apiUser      : prodApiUser,
    apiPwd       : 'Ey0m4Q3AfY1p',
    monitorUser  : `${prodApiUser}_OP`,
    monitorPwd   : 'Ey0m4Q3AfY1p',
    apiUrl       : process.env.CTP_PROD_API_URL        || 'https://clictopay.com/payment/rest',
    monitoringUrl: process.env.CTP_PROD_MONITORING_URL || 'https://clictopay.com/epg_gui/',
    siteUrl      : merchantInfo.siteUrl,
  };

  // ── Importer les builders backend ────────────────────
  const {
    buildProdCredentialsEmail,
    buildBankEmail,
    buildForceProdEmail,
    buildRenvoyiEmail,
  } = (() => {
    // Récupérer les fonctions exportées depuis merchants.js
    // Elles ne sont pas exportées → on les reconstruit inline via require du fichier
    // Pour éviter la duplication, on passe par la route directement
    const m = require('./merchants');
    return m._builders || {};
  })();

  // ── Construire chaque email ───────────────────────────
  const emails = [];
  const errors = [];

  // 1. Email de bienvenue TEST (buildEmailHTML — config/email-prise-en-charge.js)
  try {
    const html = buildEmailHTML(merchantObj, refTest, creds);
    emails.push({
      key    : 'bienvenue_test',
      label  : '1 — Bienvenue (paramètres TEST)',
      subject: `[PREVIEW — ClicToPay · ${refTest}] Bienvenue — Vos paramètres d'accès TEST · ${dossier.raison_sociale}`,
      html,
    });
  } catch(e) { errors.push({ key: 'bienvenue_test', error: e.message }); }

  // 2. Email renvoi cahier (buildRenvoyiEmail)
  try {
    const html = _buildRenvoyiEmail(dossier.raison_sociale, pid, refTest, to);
    emails.push({
      key    : 'renvoi_cahier',
      label  : '2 — Rappel cahier de recettes',
      subject: `[PREVIEW — ClicToPay · ${refTest}] Rappel — Cahier de recettes · ${dossier.raison_sociale}`,
      html,
    });
  } catch(e) { errors.push({ key: 'renvoi_cahier', error: e.message }); }

  // 3. Email notification banque (buildBankEmail)
  try {
    const html = _buildBankEmail({
      processingId : pid,
      merchantName : dossier.raison_sociale,
      terminalId   : terminalId || '—',
      siteUrl      : merchantInfo.siteUrl,
      message      : '(Email de test — aucune action requise)',
    });
    emails.push({
      key    : 'notif_banque',
      label  : '3 — Notification banque (demande production)',
      subject: `[PREVIEW — ClicToPay] Demande passage production — ${dossier.raison_sociale} — Terminal ${terminalId || '—'}`,
      html,
    });
  } catch(e) { errors.push({ key: 'notif_banque', error: e.message }); }

  // 4. Email credentials PRODUCTION (buildProdCredentialsEmail)
  try {
    const html = _buildProdCredentialsEmail(merchantInfo, prodCreds);
    emails.push({
      key    : 'prod_credentials',
      label  : '4 — Credentials PRODUCTION (passage en production)',
      subject: `[PREVIEW — ClicToPay · ${refProd}] Passage en production — ${dossier.raison_sociale}`,
      html,
    });
  } catch(e) { errors.push({ key: 'prod_credentials', error: e.message }); }

  // 5. Email F.PROD — demande banque PAYFAC (buildForceProdEmail)
  try {
    const html = _buildForceProdEmail({
      processingId : pid,
      merchantName : dossier.raison_sociale,
      terminalId   : terminalId || '—',
      siteUrl      : merchantInfo.siteUrl,
      payfac       : { nom: 'PAYFAC DEMO', id: '00000000-0000-0000-0000-000000000000' },
      message      : '(Email de test — aucune action requise)',
      bankName     : dossier.bank_name || '—',
    });
    emails.push({
      key    : 'force_prod_banque',
      label  : '5 — F.PROD : demande banque (sous-marchand PAYFAC)',
      subject: `[PREVIEW — ClicToPay] Passage production — ${dossier.raison_sociale} — PAYFAC: DEMO`,
      html,
    });
  } catch(e) { errors.push({ key: 'force_prod_banque', error: e.message }); }

  // 6. Email alerte SLA stagnation
  try {
    const html = _buildSlaEmail({
      processing_id  : pid,
      raison_sociale : dossier.raison_sociale,
      statut         : dossier.statut || 'recettes_envoyees',
      jours_etape    : 12,
      email_contact  : to,
    }, 'danger');
    emails.push({
      key    : 'alerte_sla',
      label  : '6 — Alerte SLA (dossier en retard)',
      subject: `[PREVIEW — SMT COCKPIT 🔴] Dossier en retard — ${dossier.raison_sociale} (12j)`,
      html,
    });
  } catch(e) { errors.push({ key: 'alerte_sla', error: e.message }); }

  // ── Envoyer tous les emails ───────────────────────────
  const sent = [];
  for (const mail of emails) {
    try {
      await sendMail({
        to     : to,
        subject: mail.subject,
        html   : mail.html,
      });
      sent.push({ key: mail.key, label: mail.label, status: 'sent' });
      console.log(`[email-preview] ✅ ${mail.label} → ${to}`);
    } catch(e) {
      sent.push({ key: mail.key, label: mail.label, status: 'error', error: e.message });
      errors.push({ key: mail.key, error: e.message });
      console.error(`[email-preview] ❌ ${mail.label}:`, e.message);
    }
  }

  await logAction(req, 'EMAIL_PREVIEW_SENT', `merchant:${pid}`, {
    to, sent: sent.filter(s => s.status === 'sent').length, errors: errors.length
  });

  res.json({
    success    : errors.length === 0,
    sent_to    : to,
    merchant   : { processing_id: pid, raison_sociale: dossier.raison_sociale },
    emails_sent: sent.filter(s => s.status === 'sent').length,
    emails     : sent,
    errors     : errors.length > 0 ? errors : undefined,
  });
});

// ── GET /api/email-preview/merchant/:pid — infos marchand ─
router.get('/merchant/:pid', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const pgDb = require('../db/postgres');
    const r = await pgDb.query(
      `SELECT processing_id, raison_sociale, statut, terminal_id, mcc,
              site_url, site_web, email_contact, tracking_ref_test,
              oracle_prod, oracle_test
       FROM merchants_tracking WHERE processing_id = $1`,
      [req.params.pid]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: 'Marchand introuvable' });
    res.json({ success: true, merchant: r.rows[0] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// Builders HTML inline (copies des fonctions de merchants.js)
// séparées ici pour ne pas créer de dépendance circulaire
// ══════════════════════════════════════════════════════════

function _buildRenvoyiEmail(raisonSociale, processingId, ref, email) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#0f2444;padding:18px 28px">
    <div style="color:#fff;font-size:15px;font-weight:700">ClicToPay — Rappel Cahier de Recettes</div>
    <div style="color:#93c5fd;font-size:10px;font-family:'Courier New',monospace;margin-top:4px">Réf. ${ref}</div>
  </div>
  <div style="padding:24px 28px">
    <p style="font-size:13px;margin-bottom:14px">Madame, Monsieur,</p>
    <p style="font-size:13px;color:#475569;line-height:1.75;margin-bottom:16px">
      Dans le cadre de votre affiliation à la plateforme <strong>ClicToPay</strong>,
      nous vous rappelons que votre cahier de recettes <strong>${raisonSociale}</strong>
      est toujours en attente de retour.
    </p>
    <div style="background:#fff7ed;border-left:3px solid #f59e0b;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:16px;border-radius:0 4px 4px 0">
      ⏰ Merci de nous retourner le cahier complété dans les meilleurs délais afin de poursuivre votre mise en production.
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
      <tr style="background:#f8fafc"><td style="padding:7px 12px;color:#64748b;font-weight:600;width:45%">Raison sociale</td><td style="padding:7px 12px;color:#1a2340;font-weight:700">${raisonSociale}</td></tr>
      <tr><td style="padding:7px 12px;color:#64748b;font-weight:600">Processing ID</td><td style="padding:7px 12px;font-family:'Courier New',monospace;color:#1d4ed8">${processingId}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:7px 12px;color:#64748b;font-weight:600">Référence</td><td style="padding:7px 12px;font-family:'Courier New',monospace;color:#475569">${ref}</td></tr>
    </table>
    <p style="font-size:13px;color:#475569">Pour toute question, contactez-nous à <a href="mailto:webmaster@clictopay.com" style="color:#1d4ed8">webmaster@clictopay.com</a>.</p>
    <div style="margin-top:20px;font-size:13px;color:#475569">Cordialement,<br/><strong>L'équipe ClicToPay</strong></div>
  </div>
  <div style="background:#0f2444;padding:10px 28px;text-align:center;font-size:10px;color:#93c5fd">
    ClicToPay · Monetique Tunisie · Réf. ${ref}
  </div>
</div></body></html>`;
}

function _buildBankEmail({ processingId, merchantName, terminalId, siteUrl, message }) {
  const now = new Date().toLocaleString('fr-FR');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#0f2444;padding:18px 28px">
    <div style="color:#fff;font-size:15px;font-weight:700">ClicToPay — Demande de Passage en Production</div>
    <div style="color:#93c5fd;font-size:11px;margin-top:4px">Notification à la banque acquéreuse</div>
  </div>
  <div style="padding:24px 28px">
    <p style="font-size:13px;margin-bottom:14px">Madame, Monsieur,</p>
    <p style="font-size:13px;color:#475569;line-height:1.75;margin-bottom:16px">
      Nous vous informons que le marchand <strong>${merchantName}</strong> dont le site est
      <strong>${siteUrl}</strong>, rattaché au terminal <strong>${terminalId||'—'}</strong>,
      a finalisé ses tests d'intégration et est prêt à passer en production.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
      <tr style="background:#f8fafc"><td style="padding:7px 12px;color:#64748b;font-weight:600;width:45%">Raison sociale</td><td style="padding:7px 12px;color:#1a2340;font-weight:700">${merchantName}</td></tr>
      <tr><td style="padding:7px 12px;color:#64748b;font-weight:600">Processing ID</td><td style="padding:7px 12px;font-family:'Courier New',monospace;color:#1d4ed8">${processingId}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:7px 12px;color:#64748b;font-weight:600">Terminal ID</td><td style="padding:7px 12px;font-family:'Courier New',monospace">${terminalId||'—'}</td></tr>
      <tr><td style="padding:7px 12px;color:#64748b;font-weight:600">Site marchand</td><td style="padding:7px 12px;color:#1d4ed8">${siteUrl}</td></tr>
    </table>
    ${message ? `<div style="background:#f0f9ff;border-left:3px solid #0ea5e9;padding:10px 14px;font-size:12px;color:#0369a1;margin-bottom:16px;border-radius:0 4px 4px 0">${message}</div>` : ''}
    <p style="font-size:12px;color:#475569">Merci de procéder à l'activation en production de ce marchand.<br/>Date : ${now}</p>
  </div>
  <div style="background:#0f2444;padding:10px 28px;text-align:center;font-size:10px;color:#93c5fd">
    ClicToPay · Monetique Tunisie
  </div>
</div></body></html>`;
}

function _buildProdCredentialsEmail(m, j) {
  const support = process.env.CTP_SUPPORT_EMAIL || 'webmaster@clictopay.com';
  const year    = new Date().getFullYear();
  const row = (label, value, secret=false, bg='#fff') =>
    `<tr style="background:${bg}">
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;width:45%;font-size:12px">${label}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-family:'Courier New',monospace;font-weight:700;color:${secret?'#dc2626':'#0f2444'};font-size:12px">${value||'—'}</td>
    </tr>`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;background:#f4f6f9;}</style>
</head><body>
<div style="max-width:620px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden">
  <div style="background:#0f2444;padding:20px 32px">
    <div style="color:#fff;font-size:16px;font-weight:700">ClicToPay — Passage en Production</div>
    <div style="color:#93c5fd;font-size:11px;margin-top:4px">Vos paramètres d'accès à l'environnement de production</div>
    <div style="display:inline-block;background:#10b981;color:#fff;padding:3px 12px;border-radius:20px;font-size:10px;font-weight:700;margin-top:8px">✓ PRODUCTION ACTIVÉE</div>
    <div style="font-family:'Courier New',monospace;font-size:10px;color:#60a5fa;margin-top:6px">Réf. ${j.trackingRef}</div>
  </div>
  <div style="padding:24px 32px">
    <p style="margin-bottom:14px;font-size:13px;font-weight:600">Madame, Monsieur,</p>
    <p style="margin-bottom:14px;font-size:13px;color:#475569">
      Votre espace marchand <strong>${m.raisonSociale}</strong> est désormais activé en <strong>PRODUCTION</strong>.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#0f2444"><th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px">🏪 INFORMATIONS MARCHAND</th></tr></thead>
      <tbody>
        ${row('Raison sociale', m.raisonSociale, false, '#fff')}
        ${row('Processing ID',  m.processingId,  false, '#f8fafc')}
        ${row('Terminal ID',    m.terminalId||'—', false, '#fff')}
        ${m.siteUrl && m.siteUrl !== '—' ? row('Site marchand', m.siteUrl, false, '#f8fafc') : ''}
      </tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#1d4ed8"><th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px">🔗 API PAIEMENT — PRODUCTION</th></tr></thead>
      <tbody>
        ${row('URL API',            j.apiUrl,    false, '#fff')}
        ${row("Nom d'utilisateur",  j.apiUser,   false, '#f8fafc')}
        ${row('Mot de passe',       j.apiPwd,    true,  '#fff')}
      </tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#16a34a"><th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px">📊 PORTAIL MONITORING — PRODUCTION</th></tr></thead>
      <tbody>
        ${row('URL du portail',     j.monitoringUrl, false, '#fff')}
        ${row("Nom d'utilisateur",  j.monitorUser,   false, '#f8fafc')}
        ${row('Mot de passe',       j.monitorPwd,    true,  '#fff')}
      </tbody>
    </table>
    <div style="background:#fef2f2;border-left:3px solid #dc2626;padding:10px 14px;font-size:12px;color:#991b1b;margin:16px 0;border-radius:0 4px 4px 0">
      🔐 Ces identifiants sont strictement confidentiels. Modifiez vos mots de passe dès la première connexion.
    </div>
    <div style="font-size:13px;color:#475569;margin-top:16px">Cordialement,<br/><strong>L'équipe ClicToPay</strong><br/>
      <a href="mailto:${support}" style="color:#1d4ed8;font-size:12px">${support}</a>
    </div>
  </div>
  <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 32px;text-align:center;font-size:10px;color:#94a3b8">
    ClicToPay · Monetique Tunisie · ${year} · Réf. ${j.trackingRef}
  </div>
</div></body></html>`;
}

function _buildForceProdEmail({ processingId, merchantName, terminalId, siteUrl, payfac, message, bankName }) {
  const now = new Date().toLocaleString('fr-FR');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#0f2444;padding:18px 28px">
    <div style="color:#fff;font-size:15px;font-weight:700">ClicToPay — Passage en Production (PAYFAC)</div>
    <div style="color:#93c5fd;font-size:11px;margin-top:4px">Sous-marchand rattaché à un facilitateur de paiement</div>
  </div>
  <div style="padding:24px 28px">
    <p style="font-size:13px;margin-bottom:14px">Madame, Monsieur,</p>
    <p style="font-size:13px;color:#475569;line-height:1.75;margin-bottom:16px">
      Nous vous informons que le sous-marchand <strong>${merchantName}</strong> rattaché au PAYFAC
      <strong>${payfac.nom}</strong> est prêt pour la mise en production.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
      <tr style="background:#f8fafc"><td style="padding:7px 12px;color:#64748b;font-weight:600;width:45%">Marchand</td><td style="padding:7px 12px;color:#1a2340;font-weight:700">${merchantName}</td></tr>
      <tr><td style="padding:7px 12px;color:#64748b;font-weight:600">Processing ID</td><td style="padding:7px 12px;font-family:'Courier New',monospace;color:#1d4ed8">${processingId}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:7px 12px;color:#64748b;font-weight:600">Terminal ID</td><td style="padding:7px 12px;font-family:'Courier New',monospace">${terminalId||'—'}</td></tr>
      <tr><td style="padding:7px 12px;color:#64748b;font-weight:600">Site marchand</td><td style="padding:7px 12px;color:#1d4ed8">${siteUrl}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:7px 12px;color:#64748b;font-weight:600">PAYFAC</td><td style="padding:7px 12px;color:#7c3aed;font-weight:700">${payfac.nom}</td></tr>
      <tr><td style="padding:7px 12px;color:#64748b;font-weight:600">Banque</td><td style="padding:7px 12px">${bankName}</td></tr>
    </table>
    ${message ? `<div style="background:#f0f9ff;border-left:3px solid #0ea5e9;padding:10px 14px;font-size:12px;color:#0369a1;margin-bottom:16px;border-radius:0 4px 4px 0">${message}</div>` : ''}
    <p style="font-size:12px;color:#475569">Date : ${now}</p>
  </div>
  <div style="background:#0f2444;padding:10px 28px;text-align:center;font-size:10px;color:#93c5fd">ClicToPay · Monetique Tunisie</div>
</div></body></html>`;
}

function _buildSlaEmail(d, niveau) {
  const color = niveau === 'danger' ? '#dc2626' : '#f59e0b';
  const icon  = niveau === 'danger' ? '🔴' : '🟠';
  const label = {
    en_attente        : 'En attente de traitement',
    prise_en_charge   : 'Prise en charge',
    recettes_envoyees : 'Cahier de recettes envoyé',
    recettes_recues   : 'Recettes reçues — en attente validation',
    valide            : 'Validé — notification banque en attente',
    banque_notifiee   : 'Banque notifiée — production en attente',
  }[d.statut] || d.statut;
  const now = new Date().toLocaleString('fr-FR');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#0f2444;padding:18px 28px">
    <div style="color:#fff;font-size:15px;font-weight:700">SMT COCKPIT — Alerte SLA ${icon}</div>
    <div style="color:#93c5fd;font-size:11px;margin-top:4px">Dossier marchand en retard de traitement</div>
  </div>
  <div style="padding:24px 28px">
    <div style="background:${color}18;border-left:4px solid ${color};border-radius:4px;padding:14px 18px;margin-bottom:20px">
      <div style="font-size:16px;font-weight:700;color:${color}">${icon} Dossier bloqué depuis ${d.jours_etape} jours</div>
      <div style="font-size:13px;color:#334155;margin-top:4px">${d.raison_sociale} — ${d.processing_id}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
      <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b;font-weight:600;width:45%">Marchand</td><td style="padding:8px 12px;color:#1e293b;font-weight:700">${d.raison_sociale}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;font-weight:600">Processing ID</td><td style="padding:8px 12px;font-family:monospace;color:#1d4ed8">${d.processing_id}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b;font-weight:600">Étape actuelle</td><td style="padding:8px 12px">${label}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;font-weight:600">Durée dans cette étape</td><td style="padding:8px 12px;color:${color};font-weight:700;font-size:15px">${d.jours_etape} jour(s)</td></tr>
      <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b;font-weight:600">Niveau</td><td style="padding:8px 12px"><span style="background:${color}18;color:${color};padding:2px 10px;border-radius:20px;font-weight:600;font-size:11px">${niveau.toUpperCase()}</span></td></tr>
    </table>
    <div style="background:#fff7ed;border-radius:6px;padding:12px 16px;font-size:12px;color:#92400e">⚡ Connectez-vous à SMT COCKPIT pour traiter ce dossier.</div>
    <div style="font-size:11px;color:#94a3b8;margin-top:12px;text-align:center">${now}</div>
  </div>
  <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:10px 28px;text-align:center;font-size:11px;color:#94a3b8">SMT COCKPIT · Monetique Tunisie · Alerte SLA</div>
</div></body></html>`;
}

module.exports = router;
