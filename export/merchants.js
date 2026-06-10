// routes/merchants.js — CTP Merchants Oracle + Emails
const express  = require('express');
const oracledb = require('oracledb');
const path     = require('path');
const fs       = require('fs');
const router   = express.Router();

const { requireAuth }            = require('../middleware/auth');
const { logAction }              = require('../middleware/audit');
const { sendMail, getCcList }    = require('../config/mailer');
const { logEmail }               = require('../config/email-logger');
const { generatePassword }       = require('../config/password');

// ── SQL marchands Oracle ──────────────────────────────────
const MERCHANTS_SQL = `
  SELECT
    BPCMERCHANTDETAILS.MERCHANTLOGIN,
    BPCMERCHANTDETAILS.MERCHANTFULLNAME,
    CASE WHEN LENGTH(BPCMERCHANTDETAILS.TERMINAL_ID)=9
      THEN '0'||BPCMERCHANTDETAILS.TERMINAL_ID
      ELSE BPCMERCHANTDETAILS.TERMINAL_ID
    END AS TERMINAL_ID,
    BPCMERCHANTDETAILS.PROCESSING_ID,
    BPCMERCHANTDETAILS.CREATE_DATE,
    BPCMERCHANTDETAILS.MCC,
    MERCHANT_ACQUIRER_CONFIG.ACQUIRER_ID,
    MERCHANT_ACQUIRER_CONFIG.IS_ENABLED,
    MERCHANT_ACQUIRER_CONFIG.VISA_3DS_ID,
    MERCHANT_ACQUIRER_CONFIG.MASTER_CARD_3DS_ID,
    CASE WHEN LENGTH(MERCHANT_ACQUIRER_CONFIG.TERMINAL_ID)=9
      THEN '0'||MERCHANT_ACQUIRER_CONFIG.TERMINAL_ID
      ELSE MERCHANT_ACQUIRER_CONFIG.TERMINAL_ID
    END AS TERMINAL_ID1,
    BPCMERCHANTDETAILS.DEFAULT_LANGUAGE,
    BPCMERCHANTDETAILS.LOCALES,
    BPCMERCHANTDETAILS.ENABLED AS ENABLED1,
    BPCMERCHANTDETAILS.FAIL_URL,
    BPCMERCHANTDETAILS.BACK_URL,
    BPCMERCHANTDETAILS.MERCHANT_EMAILS,
    BPCMERCHANTDETAILS.LEGACY_MERCHANT_NUMBER,
    BPCMERCHANTDETAILS.EXTERNAL_FRAUD_CONTROL_ENABLED,
    BPCMERCHANTDETAILS.AGREEMENT_URL,
    ACQUIRER.NAME AS ACQUIRER_NAME
  FROM BPCMERCHANTDETAILS
  INNER JOIN MERCHANT_ACQUIRER_CONFIG ON BPCMERCHANTDETAILS.ID=MERCHANT_ACQUIRER_CONFIG.MERCHANT_ID
  INNER JOIN ACQUIRER ON ACQUIRER.ID=MERCHANT_ACQUIRER_CONFIG.ACQUIRER_ID
  WHERE ACQUIRER.ID > 1
`;

async function getMerchantsFromOracle(env) {
  const cfg = env === 'TEST' ? {
    user: process.env.MERCHANTS_TEST_USER, password: process.env.MERCHANTS_TEST_PASSWORD,
    connectString: `${process.env.MERCHANTS_TEST_HOST}:${process.env.MERCHANTS_TEST_PORT}/${process.env.MERCHANTS_TEST_SERVICE}`
  } : {
    user: process.env.MERCHANTS_PROD_USER, password: process.env.MERCHANTS_PROD_PASSWORD,
    connectString: `${process.env.MERCHANTS_PROD_HOST}:${process.env.MERCHANTS_PROD_PORT}/${process.env.MERCHANTS_PROD_SERVICE}`
  };
  let conn;
  try {
    conn = await oracledb.getConnection(cfg);
    const result = await conn.execute(MERCHANTS_SQL, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows;
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
}

// ── GET /api/merchants/prod ────────────────────────────
router.get('/prod', requireAuth, async (req, res) => {
  try {
    const rows = await getMerchantsFromOracle('PROD');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Erreur merchants/prod:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/merchants/test ────────────────────────────
router.get('/test', requireAuth, async (req, res) => {
  try {
    const rows = await getMerchantsFromOracle('TEST');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Erreur merchants/test:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/merchants/diag ────────────────────────────
router.get('/diag', requireAuth, async (req, res) => {
  const queries = {
    total_merchants  : `SELECT COUNT(*) AS CNT FROM BPCMERCHANTDETAILS`,
    total_users      : `SELECT COUNT(*) AS CNT FROM BPCUSERTAB WHERE MERCHANT_ID > 1`,
    with_acquirer    : `SELECT COUNT(DISTINCT BPCMERCHANTDETAILS.ID) AS CNT FROM BPCMERCHANTDETAILS INNER JOIN MERCHANT_ACQUIRER_CONFIG ON BPCMERCHANTDETAILS.ID=MERCHANT_ACQUIRER_CONFIG.MERCHANT_ID`,
  };
  let conn;
  try {
    const cfg = {
      user: process.env.MERCHANTS_PROD_USER, password: process.env.MERCHANTS_PROD_PASSWORD,
      connectString: `${process.env.MERCHANTS_PROD_HOST}:${process.env.MERCHANTS_PROD_PORT}/${process.env.MERCHANTS_PROD_SERVICE}`
    };
    conn = await oracledb.getConnection(cfg);
    const results = {};
    for (const [key, sql] of Object.entries(queries)) {
      const r = await conn.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      results[key] = r.rows[0].CNT;
    }
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
});

// ── POST /api/merchants/send-welcome ──────────────────────
// Génère credentials TEST + cahier Excel + email de bienvenue
router.post('/send-welcome', requireAuth, async (req, res) => {
  const { merchant, excelRow } = req.body;
  const processingId = merchant.PROCESSING_ID || '';
  const apiUser      = processingId;
  const monitorUser  = processingId + '_OP';
  const apiPwd       = generatePassword();
  const monitorPwd   = generatePassword();
  const toEmail      = excelRow.Email || excelRow.Webmaster || '';

  if (!toEmail) return res.status(400).json({ success: false, error: 'Adresse email introuvable' });

  const now        = new Date();
  const refDate    = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const refRandom  = Math.random().toString(36).substring(2,6).toUpperCase();
  const trackingRef= `CTP-${refDate}-${processingId.slice(-4).toUpperCase()}-${refRandom}`;
  const dateEnvoi  = now.toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });
  const heureEnvoi = now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  const apiUrl     = process.env.CTP_API_URL        || 'https://test.clictopay.com/payment/rest';
  const monitoringUrl = process.env.CTP_MONITORING_URL || 'https://test.clictopay.com/epg_gui/';

  // ── Générer le cahier des recettes Excel ───────────────
  let excelAttachment = null;
  try {
    const JSZip      = require('jszip');
    const tmplPath   = path.join(__dirname, '..', 'CahierDesRecettes_TEMPLATE.xlsx');
    const zip        = await JSZip.loadAsync(fs.readFileSync(tmplPath));
    const escXml     = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const replacements = {
      '{{RAISON_SOCIALE}}': merchant.MERCHANTFULLNAME || processingId,
      '{{PROCESSING_ID}}' : processingId,
      '{{TERMINAL_ID}}'   : merchant.TERMINAL_ID || '',
      '{{MCC}}'           : merchant.MCC || '',
      '{{SITE_URL}}'      : excelRow['URL'] || excelRow['url'] || excelRow['Site'] || '',
      '{{API_USER}}'      : apiUser,
      '{{API_PWD}}'       : apiPwd,
      '{{MONITOR_USER}}'  : monitorUser,
      '{{MONITOR_PWD}}'   : monitorPwd,
      '{{API_URL}}'       : apiUrl,
      '{{MONITORING_URL}}': monitoringUrl,
      '{{TRACKING_REF}}'  : trackingRef,
      '{{DATE_CREATION}}' : now.toLocaleDateString('fr-FR'),
      '{{EMAIL}}'         : toEmail,
    };
    for (const filename of Object.keys(zip.files)) {
      if (!filename.endsWith('.xml') && !filename.endsWith('.rels')) continue;
      const file = zip.files[filename];
      if (file.dir) continue;
      let content = await file.async('string');
      let changed = false;
      Object.entries(replacements).forEach(([ph, val]) => {
        if (content.includes(ph)) { content = content.split(ph).join(escXml(val)); changed = true; }
      });
      if (changed) zip.file(filename, content);
    }
    excelAttachment = {
      filename   : `CahierDesRecettes_ClicToPay_${processingId}.xlsx`,
      content    : await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    console.log(`✅ Cahier des recettes généré pour ${processingId}`);
  } catch (excelErr) {
    console.warn('⚠ Impossible de générer le cahier des recettes:', excelErr.message);
  }

  // ── HTML email bienvenue (porté depuis server.js v1) ──
  const htmlBody = buildWelcomeEmail({
    merchant, processingId, apiUser, apiPwd, monitorUser, monitorPwd,
    apiUrl, monitoringUrl, trackingRef, dateEnvoi, heureEnvoi, toEmail
  });

  try {
    await sendMail({
      to     : toEmail,
      subject: `[ClicToPay · ${trackingRef}] Bienvenue — Vos paramètres d'accès TEST · ${merchant.MERCHANTFULLNAME || processingId}`,
      html   : htmlBody,
      attachments: excelAttachment ? [excelAttachment] : []
    });

    // Log email dans PostgreSQL
    await logEmail({
      type: 'bienvenue', processing_id: processingId, to: toEmail,
      cc  : getCcList().join(','),
      subject: `[CTP] Bienvenue ${processingId}`, status: 'sent',
      user_id: req.user?.id
    });

    // Mettre à jour le dossier marchand si le tracking existe
    const { query } = require('../db/postgres');
    await query(
      `UPDATE merchants_tracking
       SET statut='prise_en_charge', date_prise_en_charge=NOW(),
           tracking_ref_test=$1, operateur_prise_en_charge=$2
       WHERE processing_id=$3`,
      [trackingRef, req.user?.id, processingId]
    ).catch(() => {});

    await logAction(req, 'PRISE_EN_CHARGE', `merchant:${processingId}`, { trackingRef, toEmail });

    res.json({
      success: true, sentTo: toEmail, trackingRef, apiUrl, monitoringUrl,
      excelGenerated: !!excelAttachment,
      credentials: { apiUser, apiPwd, monitorUser, monitorPwd }
    });
  } catch (err) {
    await logEmail({ type: 'bienvenue', processing_id: processingId, to: toEmail, status: 'failed', error: err.message });
    console.error('Erreur envoi email:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/merchants/notify-bank ──────────────────────
router.post('/notify-bank', requireAuth, async (req, res) => {
  const { processingId, merchantName, terminalId, siteUrl, message, bankEmail, bankName } = req.body;
  if (!bankEmail) return res.status(400).json({ success: false, error: 'Email banque introuvable' });

  const html = buildBankEmail({ processingId, merchantName, terminalId, siteUrl: siteUrl||'—', message });

  try {
    await sendMail({
      to     : bankEmail,
      subject: `[ClicToPay] Demande de passage en production — ${merchantName||processingId} — Terminal ${terminalId||'—'}`,
      html
    });
    await logEmail({ type: 'notification_banque', processing_id: processingId, to: bankEmail, cc: getCcList().join(','), status: 'sent', user_id: req.user?.id });
    await logAction(req, 'BANQUE_NOTIFIEE', `merchant:${processingId}`, { bankName, bankEmail });
    console.log(`🏦 Notification banque → ${bankEmail} | ${bankName}`);
    res.json({ success: true, sentTo: bankEmail, bankName });
  } catch (err) {
    await logEmail({ type: 'notification_banque', processing_id: processingId, to: bankEmail, status: 'failed', error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/merchants/generate-prod-credentials ────────
router.post('/generate-prod-credentials', requireAuth, (req, res) => {
  const { processingId, merchantName, terminalId, email } = req.body;
  if (!processingId) return res.status(400).json({ success: false, error: 'processingId requis' });

  const apiUser    = processingId;
  const monitorUser= processingId + '_OP';
  const apiPwd     = generatePassword();
  const monitorPwd = generatePassword();
  const now        = new Date();
  const refDate    = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const refRandom  = Math.random().toString(36).substring(2,6).toUpperCase();
  const trackingRef= `CTP-PROD-${refDate}-${processingId.slice(-4).toUpperCase()}-${refRandom}`;

  res.json({
    success: true, processingId, merchantName, terminalId, email,
    apiUser, apiPwd, monitorUser, monitorPwd, trackingRef,
    apiUrl       : process.env.CTP_PROD_API_URL        || 'https://clictopay.com/payment/rest',
    monitoringUrl: process.env.CTP_PROD_MONITORING_URL || 'https://clictopay.com/epg_gui/',
  });
});

// ── POST /api/merchants/send-prod-email ──────────────────
router.post('/send-prod-email', requireAuth, async (req, res) => {
  const { to, subject, htmlBody, processingId, merchantName } = req.body;
  if (!to) return res.status(400).json({ success: false, error: 'Email requis' });

  try {
    await sendMail({ to, subject, html: htmlBody });
    await logEmail({ type: 'passage_production', processing_id: processingId, to, cc: getCcList().join(','), status: 'sent', user_id: req.user?.id });
    await logAction(req, 'PROD_EMAIL_ENVOYE', `merchant:${processingId}`, { to });
    console.log(`🚀 Email production → ${to} | Marchand: ${merchantName||processingId}`);
    res.json({ success: true, sentTo: to });
  } catch (err) {
    await logEmail({ type: 'passage_production', processing_id: processingId, to, status: 'failed', error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/merchants/send-notification ────────────────
router.post('/send-notification', requireAuth, async (req, res) => {
  const { to, subject, body, processingId } = req.body;
  if (!to) return res.status(400).json({ success: false, error: 'Email requis' });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="font-family:Arial,sans-serif;background:#f4f6f9;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#0f2444;padding:18px 28px;text-align:center;">
      <div style="color:#fff;font-size:16px;font-weight:700;">ClicToPay — Résultat Validation Recettes</div>
    </div>
    <div style="padding:24px 28px;">
      <pre style="font-family:Arial,sans-serif;font-size:13px;color:#475569;line-height:1.7;white-space:pre-wrap;">${body.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
    </div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 28px;text-align:center;font-size:11px;color:#94a3b8;">
      ClicToPay · Monetique Tunisie · webmaster@clictopay.com
    </div>
  </div></body></html>`;

  try {
    await sendMail({ to, subject, html });
    await logEmail({ type: 'notification_marchand', processing_id: processingId, to, cc: getCcList().join(','), status: 'sent', user_id: req.user?.id });
    res.json({ success: true, sentTo: to });
  } catch (err) {
    await logEmail({ type: 'notification_marchand', processing_id: processingId, to, status: 'failed', error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/merchants/test-smtp ─────────────────────────
router.get('/test-smtp', requireAuth, async (req, res) => {
  const { createTransporter } = require('../config/mailer');
  try {
    const t = createTransporter();
    await t.verify();
    res.json({ success: true, message: 'SMTP OK' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/merchants/test-email ────────────────────────
router.get('/test-email', requireAuth, async (req, res) => {
  const to = req.query.to;
  if (!to) return res.status(400).json({ success: false, error: 'Paramètre to requis' });
  try {
    await sendMail({ to, subject: '[ClicToPay] Test email', html: '<p>Test email ClicToPay Monitoring v2.</p>' });
    res.json({ success: true, sentTo: to });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Builders HTML emails ──────────────────────────────────
function buildBankEmail({ processingId, merchantName, terminalId, siteUrl, message }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;background:#f4f6f9;}
.wrap{max-width:600px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden;}
.hdr{background:#0f2444;padding:20px 32px;}.hdr-title{color:#fff;font-size:16px;font-weight:700;}
.hdr-sub{color:#93c5fd;font-size:11px;margin-top:4px;}.body{padding:28px 32px;font-size:13px;color:#1e293b;line-height:1.8;}
p{margin-bottom:16px;}.table{width:100%;border-collapse:collapse;margin:20px 0;}
.table th{background:#0f2444;color:#fff;padding:9px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
.table td{padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;}
.table tr:last-child td{border-bottom:none;}.table tr:nth-child(even) td{background:#f8fafc;}
.table td:first-child{font-weight:600;color:#475569;width:45%;}
.table td:last-child{font-family:'Courier New',monospace;font-weight:700;color:#0f2444;}
.footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;text-align:center;font-size:11px;color:#94a3b8;}
${message?'.msg{background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;font-size:12.5px;color:#78350f;margin-top:16px;border-radius:0 4px 4px 0;}':''}</style>
</head><body><div class="wrap">
<div class="hdr"><div class="hdr-title">ClicToPay — Demande de passage en production</div>
<div class="hdr-sub">Monetique Tunisie · Plateforme de paiement électronique</div></div>
<div class="body"><p>Bonjour,</p>
<p>Nous avons l'honneur de vous informer que le commerçant <strong>${merchantName||processingId}</strong>,
affilié sous votre établissement sous le numéro <strong>${processingId||'—'}</strong>,
a accompli avec succès l'ensemble des tests nécessaires pour l'acceptation des paiements par cartes bancaires en ligne sur le site
<strong>${siteUrl}</strong>, rattaché au terminal <strong>${terminalId||'—'}</strong>.</p>
<table class="table"><thead><tr><th>Paramètre</th><th>Valeur</th></tr></thead><tbody>
<tr><td>Raison sociale</td><td>${merchantName||'—'}</td></tr>
<tr><td>Numéro d'affiliation</td><td>${processingId||'—'}</td></tr>
<tr><td>Numéro de terminal</td><td>${terminalId||'—'}</td></tr>
<tr><td>Site marchand</td><td>${siteUrl}</td></tr></tbody></table>
<p>Par ailleurs, nous vous demandons de bien vouloir nous fixer <strong>la date de passage en production</strong>
ainsi que <strong>les types de cartes acceptées</strong> (Nationales et/ou Internationales).</p>
${message?`<div class="msg"><strong>Remarques :</strong> ${message}</div>`:''}
<p style="margin-top:20px;">Dans l'attente de votre retour, nous restons à votre disposition.</p>
<p>Bien cordialement,<br/><strong>L'équipe ClicToPay — Monetique Tunisie</strong><br/>
<span style="color:#2563eb;">webmaster@clictopay.com</span></p></div>
<div class="footer">ClicToPay · Monetique Tunisie · Plateforme de paiement électronique sécurisée</div>
</div></body></html>`;
}

function buildWelcomeEmail({ merchant, processingId, apiUser, apiPwd, monitorUser, monitorPwd,
                             apiUrl, monitoringUrl, trackingRef, dateEnvoi, heureEnvoi, toEmail }) {
  // Corps HTML identique à server.js v1 — porté ici directement
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Helvetica Neue',Arial,sans-serif;background:#eef2f7;color:#1a2340;}
.outer{max-width:720px;margin:32px auto;padding:0 12px;}
.hdr{background:#ffffff;border-radius:10px 10px 0 0;padding:24px 36px;border-bottom:1px solid #e8ecf1;}
.ref-bar{background:linear-gradient(90deg,#1e3a8a,#2563eb);color:#fff;padding:9px 36px;font-size:11px;font-family:'Courier New',monospace;letter-spacing:.3px;}
.body{background:#ffffff;padding:28px 36px;}
.section{margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;}
.section-hdr{background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#64748b;}
table.tp{width:100%;border-collapse:collapse;}
table.tp td{padding:9px 16px;font-size:13px;border-bottom:1px solid #f1f5f9;}
table.tp tr:last-child td{border-bottom:none;}
table.tp td.lbl{color:#64748b;width:44%;font-size:12px;font-weight:600;}
table.tp td.val{font-family:'Courier New',monospace;font-weight:700;color:#1a2340;}
table.tp td.val.secret{color:#dc2626;}
.footer-bar{background:#0f2444;color:#94a3b8;text-align:center;padding:14px;font-size:10px;border-radius:0 0 10px 10px;}
.warn{background:#fff7ed;border-left:3px solid #f59e0b;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:16px;border-radius:0 4px 4px 0;}
</style></head><body>
<div class="outer">
<div class="hdr"><strong style="font-size:16px;">ClicToPay — Bienvenue sur la plateforme</strong></div>
<div class="ref-bar">Réf. <b>${trackingRef}</b> &nbsp;|&nbsp; ${dateEnvoi} à ${heureEnvoi}</div>
<div class="body">
<p style="margin-bottom:16px;font-size:13px;color:#475569;line-height:1.75;">
Bonjour,<br/><br/>
Nous avons le plaisir de vous accueillir sur la plateforme de paiement en ligne <strong>ClicToPay</strong>.
Vous trouverez ci-dessous vos paramètres d'accès à l'environnement de <strong>TEST</strong>.
</p>

<div class="warn">⚠️ Ces identifiants sont strictement confidentiels. Ne les communiquez à aucun tiers.</div>

<div class="section">
<div class="section-hdr">🏪 Informations Marchand</div>
<table class="tp">
<tr><td class="lbl">Raison sociale</td><td class="val">${merchant.MERCHANTFULLNAME||processingId}</td></tr>
<tr><td class="lbl">Processing ID</td><td class="val">${processingId}</td></tr>
<tr><td class="lbl">Terminal ID</td><td class="val">${merchant.TERMINAL_ID||'—'}</td></tr>
<tr><td class="lbl">MCC</td><td class="val">${merchant.MCC||'—'}</td></tr>
</table></div>

<div class="section">
<div class="section-hdr">🔗 API Paiement — TEST</div>
<table class="tp">
<tr><td class="lbl">URL API</td><td class="val">${apiUrl}</td></tr>
<tr><td class="lbl">Nom d'utilisateur</td><td class="val">${apiUser}</td></tr>
<tr><td class="lbl">Mot de passe</td><td class="val secret">${apiPwd}</td></tr>
</table></div>

<div class="section">
<div class="section-hdr">📊 Portail Monitoring — TEST</div>
<table class="tp">
<tr><td class="lbl">URL Portail</td><td class="val">${monitoringUrl}</td></tr>
<tr><td class="lbl">Nom d'utilisateur</td><td class="val">${monitorUser}</td></tr>
<tr><td class="lbl">Mot de passe</td><td class="val secret">${monitorPwd}</td></tr>
</table></div>

<p style="font-size:13px;color:#475569;line-height:1.75;margin-top:16px;">
Le cahier des recettes est joint à cet email. Veuillez l'exécuter et nous le retourner complété.<br/><br/>
Bien cordialement,<br/><strong>L'équipe ClicToPay — Monetique Tunisie</strong><br/>
<span style="color:#2563eb;">webmaster@clictopay.com</span></p>
</div>
<div class="footer-bar">ClicToPay · Monetique Tunisie · Réf. ${trackingRef}</div>
</div></body></html>`;
}

module.exports = router;
