// routes/merchants.js — CTP Merchants Oracle + Emails
const express  = require('express');
const oracledb = require('oracledb');
const path     = require('path');
const fs       = require('fs');
const router   = express.Router();

const { requireAuth, requireRole }       = require('../middleware/auth');
const { logAction }              = require('../middleware/audit');
const { sendMail, getCcList }    = require('../config/mailer');

// ── Helper : extraire les emails CC d'une banque ─────────
function getBankCcEmails(bank) {
  if (!bank) return [];
  const emails = [];
  if (bank.email) emails.push(bank.email);
  if (bank.email_cc) {
    bank.email_cc.split(';').map(e => e.trim()).filter(Boolean).forEach(e => emails.push(e));
  }
  return emails;
}

// ── Générateur mot de passe PRODUCTION ──────────────────
// 12 caractères : lettres majuscules/minuscules + chiffres, sans caractères spéciaux
function generateProdPassword() {
  const chars   = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits  = '23456789';
  const allChars = chars + digits;
  let pwd = '';
  // Garantir au moins 2 chiffres et 2 majuscules
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += chars.slice(0,26)[Math.floor(Math.random() * 26)]; // majuscule
  pwd += chars.slice(0,26)[Math.floor(Math.random() * 26)]; // majuscule
  for (let i = 0; i < 8; i++) {
    pwd += allChars[Math.floor(Math.random() * allChars.length)];
  }
  // Mélanger
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

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
// Génère credentials TEST + cahier Excel (template validé) + email de bienvenue
router.post('/send-welcome', requireAuth, async (req, res) => {
  const { query: pgQuery } = require('../db/postgres');
  const { merchant, excelRow } = req.body;
  const processingId = merchant.PROCESSING_ID || '';
  const toEmail      = (excelRow?.Email || excelRow?.Webmaster || excelRow?._email || '').trim();

  if (!toEmail)      return res.status(400).json({ success: false, error: 'Adresse email introuvable' });
  if (!processingId) return res.status(400).json({ success: false, error: 'Processing ID manquant' });

  // ── 1. Importer le nouveau module email ────────────────
  const {
    generateRef, generateTestCredentials, buildCahierRecettes, buildEmailHTML
  } = require('../config/email-prise-en-charge');

  const ref = generateRef(processingId);

  // Objet marchand normalisé pour les helpers
  const merchantObj = {
    processing_id : processingId,
    raison_sociale: merchant.MERCHANTFULLNAME || processingId,
    terminal_id   : merchant.TERMINAL_ID      || '',
    mcc           : merchant.MCC              || excelRow?.MCC || '',
    email_contact : toEmail,
    site_web      : '',  // sera enrichi depuis la DB ci-dessous
  };

  const terminalId = merchantObj.terminal_id;
  const creds = generateTestCredentials(processingId, terminalId);

  // ── 1bis. Enrichir site_web depuis DB site_url ────────
  // site_url = colonne URL du fichier BPC Excel — source de vérité
  // Rejeter les valeurs qui ressemblent à un email (contiennent @)
  try {
    const dbRow = await pgQuery(
      'SELECT site_url FROM merchants_tracking WHERE processing_id = $1',
      [processingId]
    ).catch(() => ({ rows: [] }));
    const raw = (dbRow.rows[0]?.site_url || '').trim();
    if (raw && !raw.includes('@')) {
      merchantObj.site_web = raw;
    }
  } catch(e) {
    console.warn('[send-welcome] Enrichissement site_url:', e.message);
  }

  // ── 2. Générer le cahier de recettes pré-rempli ────────
  let attachment = null;
  try {
    const cahier = await buildCahierRecettes(merchantObj, ref, creds);
    if (cahier) {
      attachment = {
        filename   : cahier.filename,
        content    : cahier.content,
        contentType: cahier.contentType,
      };
      console.log(`[send-welcome] ✅ Pièce jointe : ${cahier.filename} (${cahier.content.length} bytes)`);
    } else {
      console.warn('[send-welcome] ⚠️  buildCahierRecettes a retourné null — vérifiez les logs [cahier]');
    }
  } catch(excelErr) {
    console.error('[send-welcome] ❌ buildCahierRecettes exception:', excelErr.message, excelErr.stack);
  }

  // ── 2bis. Joindre le Manuel d'intégration PDF ───────────
  let manuelAttachment = null;
  try {
    const ROOT         = path.join(__dirname, '..');
    const MANUEL_NAME  = 'Manuel_Integration_ClicToPay_v1.0.pdf';
    const manuelPaths  = [
      path.join(ROOT, MANUEL_NAME),
      path.join(ROOT, 'Manuel_Integration_ClicToPay_v1_0.pdf'),
      path.join(process.cwd(), MANUEL_NAME),
    ];
    let manuelPath = null;
    for (const p of manuelPaths) {
      if (fs.existsSync(p)) { manuelPath = p; break; }
    }
    if (manuelPath) {
      manuelAttachment = {
        filename   : "Manuel_Integration_ClicToPay_v1.0.pdf",
        content    : fs.readFileSync(manuelPath),
        contentType: 'application/pdf',
      };
      console.log(`[send-welcome] ✅ Manuel PDF joint : ${manuelPath}`);
    } else {
      console.warn(`[send-welcome] ⚠️  Manuel PDF introuvable — copiez ${MANUEL_NAME} à la racine du projet`);
    }
  } catch(pdfErr) {
    console.error('[send-welcome] ❌ Manuel PDF exception:', pdfErr.message);
  }

  // ── 3. Résoudre la banque du marchand pour le CC ─────────
  // Les 2 premiers chiffres du processing_id = code banque
  let bankEmail = null;
  let bankName  = null;
  try {
    const pid     = String(processingId).replace(/\D/g, '');
    let   bankRow = null;
    for (let len = 2; len >= 1; len--) {
      const code   = pid.substring(0, len).padStart(2, '0');
      const result = await pgQuery(
        'SELECT * FROM banks WHERE code = $1 AND actif = true', [code]
      ).catch(() => ({ rows: [] }));
      if (result.rows[0]) { bankRow = result.rows[0]; break; }
    }
    if (bankRow?.email) {
      bankEmail = getBankCcEmails(bankRow).join(',');
      bankName  = bankRow.name;
      console.log(`[send-welcome] Banque détectée : ${bankName} → CC: ${bankEmail}`);
    } else {
      console.log(`[send-welcome] Aucune banque trouvée pour processing_id: ${processingId}`);
    }
  } catch(e) {
    console.warn('[send-welcome] Erreur résolution banque:', e.message);
  }

  // Construire la liste CC : défauts SMTP + banque du marchand
  const ccBase  = getCcList();                                    // CC par défaut (.env SMTP_CC)
  // Inclure tous les emails CC de la banque (principal + supplémentaires)
  const bankEmails = bankEmail ? bankEmail.split(',').map(e=>e.trim()).filter(Boolean) : [];
  const ccFinal = [...ccBase, ...bankEmails].filter((v, i, a) => v && a.indexOf(v) === i);

  console.log(`[send-welcome] CC final : ${ccFinal.join(', ') || '(aucun)'}`);

  // ── 4. Construire l'email HTML (nouveau template validé) ─
  const htmlBody = buildEmailHTML(merchantObj, ref, creds);
  const subject  = `[ClicToPay · ${ref}] Bienvenue — Vos paramètres d'accès TEST · ${merchantObj.raison_sociale}`;

  console.log(`[send-welcome] Envoi → ${toEmail} | attachment: ${attachment ? attachment.filename : 'AUCUN'}`);

  // ── 5. Envoyer l'email ─────────────────────────────────
  try {
    const attachments = [
      ...(attachment       ? [attachment]       : []),
      ...(manuelAttachment ? [manuelAttachment] : []),
    ];

    await sendMail({
      to         : toEmail,
      cc         : ccFinal,
      subject,
      html       : htmlBody,
      attachments,
    });

    // Log email
    await logEmail({
      type        : 'bienvenue',
      processing_id: processingId,
      to          : toEmail,
      cc          : ccFinal.join(','),
      subject,
      status      : 'sent',
      user_id     : req.user?.id,
    });

    // ── 6. Mettre à jour le statut → recettes_envoyees ───
    await pgQuery(
      `UPDATE merchants_tracking
       SET statut                    = 'recettes_envoyees',
           date_prise_en_charge      = COALESCE(date_prise_en_charge, NOW()),
           date_envoi_recettes       = NOW(),
           tracking_ref_test         = $1,
           operateur_prise_en_charge = COALESCE(operateur_prise_en_charge, $2)
       WHERE processing_id = $3`,
      [ref, req.user?.id, processingId]
    ).catch(e => console.warn('⚠️  Update statut tracking:', e.message));

    await logAction(req, 'RECETTES_ENVOYEES', `merchant:${processingId}`, {
      ref, toEmail, bankCC: bankEmail || null
    });

    console.log(`📧 Email recettes envoyé → ${toEmail} | CC: ${ccFinal.join(', ')} | Réf: ${ref}`);

    // ── Provisionnement UAT automatique (non bloquant) ──
    // Lance en arrière-plan — l'email est déjà envoyé
    setImmediate(async () => {
      try {
        const { runProvision } = require('./provision-uat');
        const uatResult = await runProvision(processingId, 'auto:send-welcome');
        if (uatResult.success) {
          console.log(`[UAT] ✅ Provisionné automatiquement — ${processingId} → merchantId=${uatResult.merchantId}`);
        } else {
          console.warn(`[UAT] ⚠️  Provisionnement auto échoué — ${processingId} — étape: ${uatResult.step} — ${uatResult.error}`);
        }
      } catch(e) {
        console.error(`[UAT] ❌ Exception provisionnement auto — ${processingId}:`, e.message);
      }
    });

    // ── Provisionnement UAT automatique (non bloquant) ──
    // Lance en arrière-plan — n'attend pas le résultat pour répondre au client
    setImmediate(async () => {
      try {
        const { runProvision } = require('./provision-uat');
        console.log(`[UAT] 🚀 Déclenchement automatique post send-welcome — ${processingId}`);
        const prov = await runProvision(processingId, 'auto:send-welcome');
        if (prov.success) {
          console.log(`[UAT] ✅ Auto-provisionnement OK — ${processingId} / merchantId=${prov.merchantId}`);
        } else {
          console.warn(`[UAT] ⚠️  Auto-provisionnement échoué (step ${prov.step}) — ${prov.error}`);
        }
      } catch(e) {
        console.error(`[provision-uat] ❌ Exception auto-provisionnement — ${e.message}`);
      }
    });

    res.json({
      success      : true,
      sentTo       : toEmail,
      cc           : ccFinal,
      bankCC       : bankEmail  || null,
      bankName     : bankName   || null,
      trackingRef  : ref,
      excelJoined  : !!attachment,
      manuelJoined : !!manuelAttachment,
      credentials  : {
        apiUser    : creds.apiUser,
        apiPwd     : creds.apiPwd,
        monitorUser: creds.monitorUser,
        monitorPwd : creds.monitorPwd,
      },
    });
  } catch(err) {
    await logEmail({
      type: 'bienvenue', processing_id: processingId,
      to: toEmail, status: 'failed', error: err.message,
    });
    console.error('❌ Erreur envoi email bienvenue:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/merchants/notify-bank ──────────────────────
router.post('/notify-bank', requireAuth, async (req, res) => {
  const { processingId, merchantName, terminalId, siteUrl: siteUrlReq, message, bankEmail, bankName } = req.body;
  if (!bankEmail) return res.status(400).json({ success: false, error: 'Email banque introuvable' });

  const pgDb = require('../db/postgres');

  // Résoudre siteUrl : priorité DB > cahier > fallback '—'
  let siteUrl = siteUrlReq || '';
  if (!siteUrl || siteUrl === '—') {
    try {
      const r = await pgDb.query(
        'SELECT site_url FROM merchants_tracking WHERE processing_id = $1',
        [processingId]
      ).catch(() => ({ rows: [] }));
      const raw = (r.rows[0]?.site_url || '').trim();
      if (raw && !raw.includes('@')) siteUrl = raw;
    } catch(e) { console.warn('[notify-bank] site_url DB:', e.message); }
  }
  siteUrl = siteUrl || '—';

  // Récupérer les emails CC supplémentaires de la banque
  let bankCcExtras = [];
  try {
    const code = processingId.substring(0, 2);
    const bRes = await pgDb.query(
      `SELECT email_cc FROM banks WHERE code = $1 AND actif = true`,
      [code]
    ).catch(() => ({ rows: [] }));
    if (bRes.rows[0]?.email_cc) {
      bankCcExtras = bRes.rows[0].email_cc.split(';').map(e => e.trim()).filter(Boolean);
    }
  } catch(e) { console.warn('[notify-bank] email_cc:', e.message); }

  const ccFinal = [...getCcList(), ...bankCcExtras].filter((v, i, a) => v && a.indexOf(v) === i);

  const html = buildBankEmail({ processingId, merchantName, terminalId, siteUrl, message });

  try {
    await sendMail({
      to     : bankEmail,
      cc     : ccFinal,
      subject: `[ClicToPay] Demande de passage en production — ${merchantName||processingId} — Terminal ${terminalId||'—'}`,
      html
    });
    await logEmail({ type: 'notification_banque', processing_id: processingId, to: bankEmail, cc: ccFinal.join(','), status: 'sent', user_id: req.user?.id });
    await logAction(req, 'BANQUE_NOTIFIEE', `merchant:${processingId}`, { bankName, bankEmail, cc: ccFinal });
    console.log(`🏦 Notification banque → ${bankEmail} | CC: ${ccFinal.join(', ')} | ${bankName}`);
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

  const apiUser    = (terminalId && terminalId.trim()) ? terminalId.trim() : processingId;
  const monitorUser= apiUser + '_OP';
  const apiPwd     = generateProdPassword();
  const monitorPwd = generateProdPassword();
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

// ── POST /api/merchants/resend-cahier ─────────────────────
// Action E.CR — Renvoyer le cahier de recettes
router.post('/resend-cahier', requireAuth, async (req, res) => {
  const { processingId } = req.body;
  if (!processingId) return res.status(400).json({ success:false, error:'processingId requis' });

  const pgDb = require('../db/postgres');
  const fsPkg= require('fs');
  const pathP= require('path');

  // Charger le dossier marchand
  const dossier = await pgDb.query(
    `SELECT * FROM merchants_tracking WHERE processing_id=$1`, [processingId]
  ).then(r => r.rows[0]).catch(()=>null);

  if (!dossier) return res.status(404).json({ success:false, error:'Dossier introuvable' });
  if (!dossier.email_contact) return res.status(400).json({ success:false, error:'Email marchand manquant' });

  const { generateRef, generateTestCredentials, buildCahierRecettes, buildEmailHTML } =
    require('../config/email-prise-en-charge');

  // Utiliser la référence existante ou en créer une nouvelle
  const ref = dossier.tracking_ref_test || generateRef(processingId);

  const merchantObj = {
    processing_id : processingId,
    raison_sociale: dossier.raison_sociale,
    terminal_id   : dossier.terminal_id || '',
    mcc           : dossier.mcc || '',
    email_contact : dossier.email_contact,
    site_web      : (() => {
      const v = dossier.site_url || dossier.site_web || '';
      return (v && !v.includes('@')) ? v : '';
    })(),
  };

  const terminalId = merchantObj.terminal_id;
  const creds = generateTestCredentials(processingId, terminalId);

  // Vérifier si le cahier existe déjà dans cahiers_outbox
  const OUTBOX   = pathP.join(__dirname, '..', 'cahiers_outbox');
  const existing = fsPkg.existsSync(OUTBOX)
    ? fsPkg.readdirSync(OUTBOX).find(f => f.includes(processingId))
    : null;

  let attachment = null;
  if (existing) {
    // Réutiliser le fichier existant
    const filePath = pathP.join(OUTBOX, existing);
    console.log(`[resend-cahier] Fichier existant trouvé : ${existing}`);
    attachment = {
      filename   : existing,
      content    : fsPkg.readFileSync(filePath),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  } else {
    // Régénérer le cahier
    console.log(`[resend-cahier] Régénération du cahier pour ${processingId}`);
    const cahier = await buildCahierRecettes(merchantObj, ref, creds);
    if (cahier) attachment = { filename:cahier.filename, content:cahier.content, contentType:cahier.contentType };
  }

  // Résoudre la banque pour le CC
  let bankEmail = null;
  const pid = String(processingId).replace(/\D/g,'');
  for (let len=2; len>=1; len--) {
    const code = pid.substring(0,len).padStart(2,'0');
    const b = await pgDb.query('SELECT * FROM banks WHERE code=$1 AND actif=true',[code]).catch(()=>({rows:[]}));
    if (b.rows[0]) { bankEmail = b.rows[0].email; break; }
  }
  const ccFinal = [...getCcList(), bankEmail].filter((v,i,a) => v && a.indexOf(v)===i);

  // Email de renvoi
  const subject = `[ClicToPay · ${ref}] Rappel — Cahier de recettes · ${dossier.raison_sociale}`;
  const html    = buildRenvoyiEmail(dossier.raison_sociale, processingId, ref, dossier.email_contact);

  try {
    await sendMail({ to:dossier.email_contact, cc:ccFinal, subject, html,
      attachments: attachment ? [attachment] : [] });
    await logAction(req,'RESEND_CAHIER',`merchant:${processingId}`,{ref});
    console.log(`📨 Cahier renvoyé → ${dossier.email_contact} | ${attachment?'✅ PJ':'❌ sans PJ'}`);
    res.json({ success:true, sentTo:dossier.email_contact, ref, fileFound:!!existing, fileGenerated:!existing&&!!attachment });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── POST /api/merchants/force-production ─────────────────
// Action F.PROD — Passage forcé en production
// Disponible pour TOUS les marchands (avec ou sans PAYFAC)
// Rôles autorisés : admin, supervisor
router.post('/force-production', requireAuth, requireRole('admin','supervisor'), async (req, res) => {
  const { processingId, payfacId, toEmail, bankEmail, message } = req.body;
  if (!processingId) return res.status(400).json({ success:false, error:'processingId requis' });

  const pgDb = require('../db/postgres');

  // ── Charger le dossier avec banque ───────────────────────
  const dossier = await pgDb.query(
    `SELECT mt.*, b.email AS bank_email_auto, b.email_cc AS bank_email_cc_auto,
            b.name AS bank_name_auto
     FROM merchants_tracking mt
     LEFT JOIN banks b ON SUBSTRING(mt.processing_id, 1, 2) = LPAD(b.code::text, 2, '0')
       AND b.actif = true
     WHERE mt.processing_id = $1`, [processingId]
  ).then(r => r.rows[0]).catch(() => null);

  if (!dossier) return res.status(404).json({ success:false, error:'Dossier introuvable' });

  // ── Charger le PAYFAC si fourni (optionnel) ──────────────
  let payfac = null;
  if (payfacId) {
    payfac = await pgDb.query(
      `SELECT p.*, b.name AS bank_name, b.email AS bank_email_payfac, b.email_cc AS bank_email_cc_payfac
       FROM payfacs p LEFT JOIN banks b ON p.bank_id = b.id WHERE p.id = $1`, [payfacId]
    ).then(r => r.rows[0]).catch(() => null);
  }

  // ── Générer les credentials PRODUCTION ──────────────────
  const now         = new Date();
  const refDate     = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const refRandom   = Math.random().toString(36).substring(2,6).toUpperCase();
  const trackingRef = `CTP-PROD-${refDate}-${processingId.slice(-4).toUpperCase()}-${refRandom}`;
  const apiUser     = (dossier.terminal_id && dossier.terminal_id.trim()) ? dossier.terminal_id.trim() : processingId;
  const monitorUser = `${apiUser}_OP`;
  const apiPwd      = generateProdPassword();
  const monitorPwd  = generateProdPassword();
  const apiUrl         = process.env.CTP_PROD_API_URL        || 'https://clictopay.com/payment/rest';
  const monitoringUrl  = process.env.CTP_PROD_MONITORING_URL || 'https://clictopay.com/epg_gui/';

  const creds = { trackingRef, apiUser, apiPwd, monitorUser, monitorPwd, apiUrl, monitoringUrl };

  const _rawSiteUrl    = dossier.site_url || dossier.site_web || '';
  const siteUrlResolved = (_rawSiteUrl && !_rawSiteUrl.includes('@')) ? _rawSiteUrl : '—';

  const merchantInfo = {
    raisonSociale : dossier.raison_sociale,
    processingId,
    terminalId    : dossier.terminal_id || '—',
    siteUrl       : siteUrlResolved,
  };

  // ── Construire la liste CC commune ──────────────────────
  const bankEmailTo  = bankEmail || dossier.bank_email_auto
                    || payfac?.bank_email_payfac || null;
  const bankCcExtras = [
    ...(dossier.bank_email_cc_auto  || '').split(';'),
    ...(payfac?.bank_email_cc_payfac || '').split(';'),
  ].map(e => e.trim()).filter(Boolean);
  const ccBase = [...getCcList(), ...bankCcExtras]
    .filter((v, i, a) => v && a.indexOf(v) === i);

  // ── Email 1 : Notification banque ───────────────────────
  // Envoyé à la banque (bankEmailTo) — informer du passage en production
  const bankName    = dossier.bank_name_auto || payfac?.bank_name || '—';
  const subjectBank = `[ClicToPay] Passage en production — ${dossier.raison_sociale}${payfac ? ` — PAYFAC: ${payfac.nom}` : ''}`;
  const htmlBank    = buildForceProdEmail({
    processingId,
    merchantName : dossier.raison_sociale,
    terminalId   : dossier.terminal_id || '—',
    siteUrl      : siteUrlResolved,
    payfac       : payfac || { nom: '—', bank_name: bankName },
    message      : message || '',
    bankName,
  });

  // ── Email 2 : Credentials PRODUCTION au marchand ────────
  // Envoyé au marchand — contient les paramètres API PROD
  const to          = toEmail || dossier.email_contact;
  const subjectProd = `[ClicToPay · ${trackingRef}] Passage en production — ${dossier.raison_sociale}`;
  const htmlProd    = buildProdCredentialsEmail(merchantInfo, creds);

  try {
    const emailPromises = [];

    // Email banque — si on a un destinataire banque
    if (bankEmailTo) {
      emailPromises.push(
        sendMail({ to: bankEmailTo, cc: ccBase, subject: subjectBank, html: htmlBank })
          .then(() => console.log(`🏦 F.PROD email banque → ${bankEmailTo}`))
      );
    }

    // Email marchand — toujours envoyé
    emailPromises.push(
      sendMail({ to, cc: ccBase, subject: subjectProd, html: htmlProd })
        .then(() => console.log(`📧 F.PROD email marchand → ${to}`))
    );

    await Promise.all(emailPromises);

    // ── Sync Oracle PROD ─────────────────────────────────
    // Tenter la sync Oracle PROD (oracle_prod = true)
    try {
      const oracledb = require('oracledb');
      const oConn    = await oracledb.getConnection('merchants_prod');
      try {
        // Vérifier présence dans Oracle PROD
        const r = await oConn.execute(
          `SELECT COUNT(*) FROM BPCMERCHANTDETAILS WHERE PROCESSINGID = :pid`,
          { pid: processingId }
        );
        const inProd = (r.rows[0][0] > 0);
        await pgDb.query(
          `UPDATE merchants_tracking SET oracle_prod = $1 WHERE processing_id = $2`,
          [inProd, processingId]
        );
        console.log(`[F.PROD] Oracle PROD sync : ${processingId} → oracle_prod=${inProd}`);
      } finally {
        await oConn.close();
      }
    } catch(oErr) {
      console.warn(`[F.PROD] Oracle PROD sync ignorée : ${oErr.message}`);
    }

    // ── Mettre à jour le statut → en_production ──────────
    await pgDb.query(
      `UPDATE merchants_tracking
       SET statut              = 'en_production',
           date_production     = NOW(),
           date_notif_banque   = COALESCE(date_notif_banque, NOW()),
           tracking_ref_prod   = $1
       WHERE processing_id = $2`,
      [trackingRef, processingId]
    );

    await logAction(req, 'FORCE_PRODUCTION', `merchant:${processingId}`, {
      payfac    : payfac?.nom || 'sans PAYFAC',
      bankEmailTo,
      merchantTo: to,
      trackingRef,
      statut    : 'en_production',
    });

    console.log(`🚀 F.PROD OK — ${processingId} | Réf: ${trackingRef} | Marchand: ${to} | Banque: ${bankEmailTo || '—'}`);
    res.json({
      success   : true,
      sentTo    : to,
      bankSentTo: bankEmailTo || null,
      cc        : ccBase,
      payfac    : payfac?.nom || null,
      trackingRef,
      statut    : 'en_production',
    });
  } catch(e) {
    console.error('[F.PROD]', e.message);
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── POST /api/merchants/reset-progression ────────────────
// Réinitialiser la progression d'un dossier → en_attente
router.post('/reset-progression', requireAuth, requireRole('admin'), async (req, res) => {
  const { processingId } = req.body;
  if (!processingId) return res.status(400).json({ success:false, error:'processingId requis' });

  const pgDb = require('../db/postgres');
  try {
    await pgDb.query(`
      UPDATE merchants_tracking SET
        statut='en_attente',
        date_prise_en_charge=NULL, operateur_prise_en_charge=NULL,
        date_envoi_recettes=NULL,  date_reception_recettes=NULL,
        date_validation=NULL,      operateur_validation=NULL,
        date_notif_banque=NULL,    date_production=NULL,
        tracking_ref_test=NULL,    notes=NULL
      WHERE processing_id=$1`, [processingId]);
    await logAction(req,'RESET_PROGRESSION',`merchant:${processingId}`);
    console.log(`🔄 Progression réinitialisée : ${processingId}`);
    res.json({ success:true });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── Builders HTML emails ──────────────────────────────────

function buildProdCredentialsEmail(m, j) {
  const support = process.env.CTP_SUPPORT_EMAIL || 'webmaster@clictopay.com';
  const year    = new Date().getFullYear();

  const row = (label, value, secret=false, bg='#fff') =>
    `<tr style="background:${bg}">
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;width:45%;font-size:12px">${label}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-family:'Courier New',monospace;font-weight:700;color:${secret?'#dc2626':'#0f2444'};font-size:12px">${value||'—'}</td>
    </tr>`;

  const secRow = (label, text, bg='#fff') =>
    `<tr style="background:${bg}">
      <td style="padding:8px 12px;border-bottom:1px solid #fecaca;color:#dc2626;font-weight:700;font-size:11px;width:30%;vertical-align:top">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #fecaca;color:#374151;font-size:12px">${text}</td>
    </tr>`;

  return `<!DOCTYPE html><html lang="fr"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:Arial,sans-serif;background:#f4f6f9;}
  .wrap{max-width:620px;margin:24px auto;background:#fff;border-radius:8px;
        box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden;}
  .hdr{background:#0f2444;padding:20px 32px;}
  .hdr-title{color:#fff;font-size:16px;font-weight:700;}
  .hdr-sub{color:#93c5fd;font-size:11px;margin-top:4px;}
  .hdr-badge{display:inline-block;background:#10b981;color:#fff;padding:3px 12px;
             border-radius:20px;font-size:10px;font-weight:700;margin-top:8px;}
  .hdr-ref{font-family:'Courier New',monospace;font-size:10px;color:#60a5fa;margin-top:6px;}
  .body{padding:24px 32px;}
  .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 32px;
          text-align:center;font-size:10px;color:#94a3b8;}
</style>
</head><body>
<div class="wrap">
  <div class="hdr">
    <div class="hdr-title">ClicToPay — Passage en Production</div>
    <div class="hdr-sub">Vos paramètres d'accès à l'environnement de production</div>
    <div class="hdr-badge">✓ PRODUCTION ACTIVÉE</div>
    <div class="hdr-ref">Réf. ${j.trackingRef}</div>
  </div>
  <div class="body">

    <p style="margin-bottom:14px;font-size:13px;font-weight:600">Madame, Monsieur,</p>
    <p style="margin-bottom:14px;font-size:13px">
      Nous avons le plaisir de vous informer que votre espace marchand
      <strong>${m.raisonSociale}</strong> est désormais activé sur l'environnement de
      <strong>PRODUCTION</strong>. Votre intégration a été validée avec succès.
    </p>
    <p style="margin-bottom:14px;font-size:13px">
      Veuillez trouver ci-dessous vos paramètres d'accès à la plateforme de production :
    </p>

    <!-- INFORMATIONS MARCHAND -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#0f2444">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          🏪 INFORMATIONS MARCHAND
        </th>
      </tr></thead>
      <tbody>
        ${row('Raison sociale',  m.raisonSociale, false, '#fff')}
        ${row('Processing ID',   m.processingId,  false, '#f8fafc')}
        ${row('Terminal ID',     m.terminalId||'—',false, '#fff')}
        ${m.siteUrl && m.siteUrl !== '—' ? row('Site marchand', m.siteUrl, false, '#f8fafc') : ''}
      </tbody>
    </table>

    <!-- API PAIEMENT PRODUCTION -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#1d4ed8">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          🔗 API PAIEMENT — PRODUCTION
        </th>
      </tr></thead>
      <tbody>
        ${row('URL API',           j.apiUrl,     false, '#fff')}
        ${row("Nom d'utilisateur", j.apiUser,    false, '#f8fafc')}
        ${row('Mot de passe',      j.apiPwd,     true,  '#fff')}
      </tbody>
    </table>

    <!-- PORTAIL MONITORING PRODUCTION -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#15803d">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          📊 PORTAIL MONITORING — PRODUCTION
        </th>
      </tr></thead>
      <tbody>
        ${row('URL du portail',    j.monitoringUrl, false, '#fff')}
        ${row("Nom d'utilisateur", j.monitorUser,   false, '#f8fafc')}
        ${row('Mot de passe',      j.monitorPwd,    true,  '#fff')}
      </tbody>
    </table>

    <!-- AVERTISSEMENT SÉCURITÉ -->
    <div style="background:#fff7ed;border-left:3px solid #f59e0b;padding:10px 14px;
                margin-bottom:14px;font-size:12px;color:#78350f;">
      ⚠️ <strong>Sécurité — Action requise :</strong> Ces identifiants sont strictement confidentiels.
      Modifiez vos mots de passe dès la première connexion. Ne les communiquez à aucun tiers.
      Ne stockez jamais les données de carte bancaire sur vos serveurs.
    </div>

    <!-- CONSIGNES ANTI-FRAUDE -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#dc2626">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          🛡 CONSIGNES DE SÉCURITÉ ANTI-FRAUDE — OBLIGATOIRES
        </th>
      </tr></thead>
      <tbody>
        ${secRow('Transactions suspectes',
          "Signalez immédiatement à votre banque acquéreur toute transaction suspecte : montant élevé, plusieurs transactions avec le même numéro de carte / adresse IP / nom / e-mail / BIN (4 premiers chiffres de la carte).",
          '#fff')}
        ${secRow('Données clients',
          "Collectez le maximum d'informations lors de l'inscription de vos clients. Exigez un KYC (CIN, justificatif) pour permettre le rapprochement en cas de litige.",
          '#fef2f2')}
        ${secRow('Données de carte',
          "⛔ Ne stockez jamais les données de carte bancaire (numéro, CVV, date d'expiration) sur vos serveurs. Cette pratique est strictement interdite par les normes PCI-DSS.",
          '#fff')}
        ${secRow('Délai de livraison',
          "Assurez la livraison du produit ou service dans un délai minimum de 72h après le paiement, afin de permettre aux services anti-fraude des banques émettrices de réagir.",
          '#fef2f2')}
        ${secRow('Vérification identité',
          "Pour tout achat physique, exigez la pièce d'identité et la carte bancaire. Vérifiez la cohérence entre le nom sur la carte et le document d'identité présenté.",
          '#fff')}
        ${secRow('Vérification carte',
          "Comparez les données de la transaction (nom, BIN, expiration) avec la carte physique présentée par le porteur.",
          '#fef2f2')}
        ${secRow('Alertes transactions',
          "Activez les alertes de transaction sur votre portail de monitoring pour être notifié en temps réel des paiements et anomalies.",
          '#fff')}
        ${secRow('Contestations (Chargeback)',
          "En cas de contestation, conservez toutes les preuves de transaction (logs, confirmation de livraison, correspondances client) pendant au moins 18 mois.",
          '#fef2f2')}
      </tbody>
    </table>

    <p style="margin-bottom:6px;font-size:13px">
      Notre équipe reste disponible pour vous accompagner dans cette nouvelle étape.
    </p>
    <p style="margin-bottom:14px;font-size:13px">
      Bien cordialement,<br>
      <strong>L'équipe ClicToPay — Monetique Tunisie</strong><br>
      <span style="color:#2563eb">${support}</span>
    </p>

  </div>
  <div class="footer">
    ClicToPay · Monetique Tunisie · Plateforme de paiement électronique sécurisée · ${year}
  </div>
</div>
</body></html>`;
}

function buildRenvoyiEmail(raisonSociale, processingId, ref, email) {
  const now = new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#eef2f7;margin:0;padding:20px">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:linear-gradient(90deg,#1e3a8a,#2563eb);padding:10px 36px;font-size:11px;color:#fff;font-family:'Courier New',monospace">
    Référence : <b>${ref}</b></div>
  <div style="padding:28px 36px">
    <p style="font-size:15px;font-weight:700;color:#1a2340;margin-bottom:12px">Madame, Monsieur,</p>
    <p style="font-size:13px;color:#475569;line-height:1.75;margin-bottom:18px">
      Nous revenons vers vous concernant votre dossier d'affiliation à la plateforme <strong>ClicToPay</strong>.<br>
      Le cahier de recettes relatif à votre intégration est joint à ce message.
    </p>
    <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:14px 18px;border-radius:4px;margin-bottom:18px">
      <table style="width:100%;font-size:13px">
        <tr><td style="color:#64748b;padding:3px 0;width:44%">Raison sociale</td><td style="font-weight:700;color:#1a2340">${raisonSociale}</td></tr>
        <tr><td style="color:#64748b;padding:3px 0">Code marchand</td><td style="font-family:'Courier New',monospace;color:#2563eb">${processingId}</td></tr>
        <tr><td style="color:#64748b;padding:3px 0">Référence dossier</td><td style="font-family:'Courier New',monospace">${ref}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#475569;line-height:1.75;margin-bottom:8px">
      Merci de compléter le cahier de recettes joint et de nous le retourner à
      <a href="mailto:${process.env.CTP_SUPPORT_EMAIL||'webmaster@clictopay.com'}">${process.env.CTP_SUPPORT_EMAIL||'webmaster@clictopay.com'}</a>.
    </p>
    <p style="font-size:13px;color:#475569;margin-top:18px">Cordialement,<br><strong>L'équipe ClicToPay · Monetique Tunisie</strong></p>
  </div>
  <div style="background:#1e3a8a;padding:12px 36px;text-align:center;font-size:10.5px;color:#93c5fd;font-family:'Courier New',monospace">
    ClicToPay · Monetique Tunisie · ${new Date().getFullYear()} · Réf. ${ref}
  </div>
</div></body></html>`;
}

function buildForceProdEmail({ processingId, merchantName, terminalId, siteUrl, payfac, message, bankName }) {
  const support = process.env.CTP_SUPPORT_EMAIL || 'webmaster@clictopay.com';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;background:#f4f6f9;}
.wrap{max-width:620px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden;}
.hdr{background:#0f2444;padding:20px 32px;}.hdr-title{color:#fff;font-size:16px;font-weight:700;}
.hdr-sub{color:#93c5fd;font-size:11px;margin-top:4px;}
.body{padding:28px 32px;font-size:13px;color:#1e293b;line-height:1.8;}
p{margin-bottom:14px;}
.table{width:100%;border-collapse:collapse;margin:16px 0;}
.table th{background:#0f2444;color:#fff;padding:9px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
.table td{padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;}
.table tr:last-child td{border-bottom:none;}.table tr:nth-child(even) td{background:#f8fafc;}
.table td:first-child{font-weight:600;color:#475569;width:45%;}
.table td:last-child{font-family:'Courier New',monospace;font-weight:700;color:#0f2444;}
.payfac-box{background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:0 6px 6px 0;margin:16px 0;}
.payfac-box .label{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:#15803d;font-weight:700;margin-bottom:8px;}
.msg{background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;font-size:12.5px;color:#78350f;margin-top:12px;border-radius:0 4px 4px 0;}
.footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;text-align:center;font-size:11px;color:#94a3b8;}
</style></head><body><div class="wrap">
<div class="hdr">
  <div class="hdr-title">ClicToPay — Demande de passage en production</div>
  <div class="hdr-sub">Monetique Tunisie · Plateforme de paiement électronique · PAYFAC</div>
</div>
<div class="body">
  <p>Bonjour,</p>
  <p>Nous avons l'honneur de vous informer que le sous-commerçant <strong>${merchantName||processingId}</strong>
  affilié via le PAYFAC <strong>${payfac.nom}</strong> a satisfait à l'ensemble des tests d'intégration
  et est prêt pour le passage en production.</p>

  <table class="table"><thead><tr><th>Paramètre</th><th>Valeur</th></tr></thead><tbody>
    <tr><td>Raison sociale</td><td>${merchantName||'—'}</td></tr>
    <tr><td>Numéro d'affiliation</td><td>${processingId}</td></tr>
    <tr><td>Numéro de terminal</td><td>${terminalId}</td></tr>
    <tr><td>Site marchand</td><td>${siteUrl}</td></tr>
    <tr><td>Banque acquéreur</td><td>${bankName}</td></tr>
  </table>

  <div class="payfac-box">
    <div class="label">🏢 Informations PAYFAC</div>
    <table style="width:100%;font-size:12.5px">
      <tr><td style="color:#64748b;padding:3px 0;width:44%">PAYFAC</td><td style="font-weight:700">${payfac.nom}</td></tr>
      <tr><td style="color:#64748b;padding:3px 0">Identifiant</td><td style="font-family:'Courier New',monospace">${payfac.identifiant}</td></tr>
      ${payfac.responsable?`<tr><td style="color:#64748b;padding:3px 0">Responsable</td><td>${payfac.responsable}</td></tr>`:''}
      ${payfac.telephone?`<tr><td style="color:#64748b;padding:3px 0">Téléphone</td><td>${payfac.telephone}</td></tr>`:''}
      ${payfac.webmaster?`<tr><td style="color:#64748b;padding:3px 0">Webmaster</td><td>${payfac.webmaster}</td></tr>`:''}
    </table>
  </div>

  <p>Nous vous demandons de bien vouloir nous confirmer <strong>la date de passage en production</strong>
  ainsi que <strong>les types de cartes acceptées</strong> (Nationales et/ou Internationales).</p>
  ${message?`<div class="msg"><strong>Remarques :</strong> ${message}</div>`:''}
  <p style="margin-top:18px">Dans l'attente de votre retour, nous restons à votre disposition.</p>
  <p>Bien cordialement,<br><strong>L'équipe ClicToPay — Monetique Tunisie</strong><br>
  <a href="mailto:${support}" style="color:#2563eb">${support}</a></p>
</div>
<div class="footer">ClicToPay · Monetique Tunisie · Plateforme de paiement électronique sécurisée</div>
</div></body></html>`;
}

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

// ── DELETE /api/merchants/tracking/:processing_id ────────
// Suppression d'un marchand de la base locale (admin uniquement)
router.delete('/tracking/:processing_id', requireAuth, requireRole('admin'), async (req, res) => {
  const { processing_id } = req.params;
  if (!processing_id) return res.status(400).json({ success: false, error: 'processing_id requis' });

  const { query } = require('../db/postgres');
  try {
    const result = await query(
      `DELETE FROM merchants_tracking WHERE processing_id = $1 RETURNING processing_id, raison_sociale`,
      [processing_id]
    );
    if (!result.rows[0])
      return res.status(404).json({ success: false, error: 'Marchand introuvable' });

    await logAction(req, 'DELETE_MERCHANT', `merchant:${processing_id}`, {
      raison_sociale: result.rows[0].raison_sociale
    });
    console.log(`🗑️  Supprimé : ${processing_id} — ${result.rows[0].raison_sociale}`);
    res.json({ success: true, deleted: result.rows[0] });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
