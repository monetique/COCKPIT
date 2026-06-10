// routes/v1-affiliates.js — API publique d'ajout de marchands
// Auth : X-API-Key header (token haché SHA256 en base)
const express   = require('express');
const router    = express.Router();
const crypto    = require('crypto');
const { query } = require('../db/postgres');
const { sendMail, getCcList, getSender } = require('../config/mailer');
const { logAction } = require('../middleware/audit');

// ── Middleware auth token ─────────────────────────────────
async function requireApiToken(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ success:false, error:'X-API-Key manquant' });
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  try {
    const r = await query(
      `SELECT * FROM api_tokens WHERE token = $1 AND actif = true`, [hash]
    );
    const tok = r.rows[0];
    if (!tok) return res.status(401).json({ success:false, error:'Clé API invalide ou révoquée' });
    if (tok.expires_at && new Date(tok.expires_at) < new Date())
      return res.status(401).json({ success:false, error:'Clé API expirée' });
    // Stats
    await query(`UPDATE api_tokens SET derniere_util=NOW(), nb_appels=nb_appels+1 WHERE id=$1`, [tok.id]);
    req.apiToken = tok;
    next();
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
}

// ── Normaliser le code marchand (identique à l'import Excel)
function normalizeId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s.padStart(9, '0');  // numérique → 9 chiffres
  return s;                                          // alphanumérique → tel quel
}

// ── Vérifier existence Oracle PROD ───────────────────────
async function checkOracleProd(pid, req) {
  const pool = req.merchantsProdPool;
  if (!pool) return null;
  try {
    const r = await pool.execute(
      `SELECT COUNT(*) AS N FROM BPCMERCHANTDETAILS WHERE PROCESSING_ID=:pid`,
      { pid }, { outFormat: require('oracledb').OUT_FORMAT_OBJECT }
    );
    return r.rows[0]?.N > 0;
  } catch { return null; }
}

// ── Vérifier existence Oracle TEST ───────────────────────
async function checkOracleTest(pid, req) {
  const pool = req.merchantsTestPool;
  if (!pool) return null;
  try {
    const r = await pool.execute(
      `SELECT COUNT(*) AS N FROM BPCMERCHANTDETAILS WHERE PROCESSING_ID=:pid`,
      { pid }, { outFormat: require('oracledb').OUT_FORMAT_OBJECT }
    );
    return r.rows[0]?.N > 0;
  } catch { return null; }
}

// ── Log appel API ─────────────────────────────────────────
async function logApiCall(tokenId, prefix, endpoint, method, statusCode, ip, summary) {
  try {
    await query(
      `INSERT INTO api_calls_log (token_id,token_prefix,endpoint,method,status_code,ip,body_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tokenId, prefix, endpoint, method, statusCode, ip, summary]
    );
  } catch {}
}

const { generateRef, generateTestCredentials, buildCahierRecettes, buildEmailHTML } =
  require('../config/email-prise-en-charge');

// ── Prise en charge automatique ───────────────────────────
async function autoPriseEnCharge(merchant, tokenNom) {
  console.log('\n[auto-onboard] ════════════════════════════════════════');
  console.log(`[auto-onboard] 🚀 Démarrage prise en charge automatique`);
  console.log(`[auto-onboard] Marchand  : ${merchant.processing_id} — ${merchant.raison_sociale}`);
  console.log(`[auto-onboard] Email     : ${merchant.email_contact}`);
  console.log(`[auto-onboard] Terminal  : ${merchant.terminal_id || '(absent)'}`);
  console.log(`[auto-onboard] Token     : ${tokenNom}`);
  console.log('[auto-onboard] ════════════════════════════════════════\n');
  try {
    const ref   = generateRef(merchant.processing_id);
    const creds = generateTestCredentials(merchant.processing_id, merchant.terminal_id);
    console.log(`[auto-onboard] Réf générée : ${ref}`);

    // 1. Update statut
    await query(
      `UPDATE merchants_tracking
       SET statut='prise_en_charge', date_prise_en_charge=NOW(),
           auto_onboard=true, onboard_sent_at=NOW(), tracking_ref_test=$2
       WHERE processing_id=$1`,
      [merchant.processing_id, ref]
    );
    console.log(`[auto-onboard] Statut → prise_en_charge`);

    // 2. Résoudre la banque
    let bankEmail = null, bankName = null;
    try {
      const pid = String(merchant.processing_id).replace(/\D/g,'');
      for (let len = 2; len >= 1; len--) {
        const code   = pid.substring(0, len).padStart(2,'0');
        const result = await query('SELECT * FROM banks WHERE code=$1 AND actif=true',[code]).catch(()=>({rows:[]}));
        if (result.rows[0]) { bankEmail = result.rows[0].email; bankName = result.rows[0].name; break; }
      }
      if (bankEmail) console.log(`[auto-onboard] Banque: ${bankName} → CC: ${bankEmail}`);
      else           console.log(`[auto-onboard] Aucune banque trouvée pour ${merchant.processing_id}`);
    } catch(e) { console.warn('[auto-onboard] Banque:', e.message); }

    const ccBase  = getCcList();
    const ccFinal = bankEmail
      ? [...ccBase, bankEmail].filter((v,i,a) => v && a.indexOf(v)===i)
      : ccBase;
    console.log(`[auto-onboard] CC: ${ccFinal.join(', ') || '(aucun)'}`);

    // 3. Générer le cahier
    console.log(`[auto-onboard] Génération cahier recettes…`);
    const cahier = await buildCahierRecettes(merchant, ref, creds);
    console.log(`[auto-onboard] Cahier: ${cahier ? cahier.filename + ' (' + cahier.content.length + ' bytes)' : 'NULL — sans PJ'}`);

    // 4. Construire l'email
    const html   = buildEmailHTML(merchant, ref, creds);
    const subject = `[ClicToPay · ${ref}] Bienvenue — Vos paramètres d'accès TEST · ${merchant.raison_sociale}`;

    const mailOptions = {
      to     : merchant.email_contact,
      cc     : ccFinal,
      subject,
      html,
    };

    // Pièces jointes : cahier Excel + Manuel d'intégration PDF
    const attachments = [];
    if (cahier) attachments.push({ filename: cahier.filename, content: cahier.content, contentType: cahier.contentType });

    // Manuel PDF
    try {
      const fs   = require('fs');
      const path = require('path');
      const manuelPaths = [
        path.join(__dirname, '..', 'Manuel_Integration_ClicToPay_v1.0.pdf'),
        path.join(process.cwd(), 'Manuel_Integration_ClicToPay_v1.0.pdf'),
      ];
      for (const p of manuelPaths) {
        if (fs.existsSync(p)) {
          attachments.push({ filename: 'Manuel_Integration_ClicToPay_v1.0.pdf', content: fs.readFileSync(p), contentType: 'application/pdf' });
          console.log(`[auto-onboard] Manuel PDF joint : ${p}`);
          break;
        }
      }
    } catch(e) { console.warn('[auto-onboard] Manuel PDF:', e.message); }

    if (attachments.length) mailOptions.attachments = attachments;

    // 5. Envoyer
    console.log(`[auto-onboard] Envoi email → ${merchant.email_contact} | PJ: ${cahier?'OUI':'NON'}`);
    await sendMail(mailOptions);
    console.log(`[auto-onboard] ✅ Email envoyé → ${merchant.email_contact} | Réf: ${ref}`);

    // 6. Update statut final
    await query(
      `UPDATE merchants_tracking SET statut='recettes_envoyees', date_envoi_recettes=NOW() WHERE processing_id=$1`,
      [merchant.processing_id]
    );
    console.log(`[auto-onboard] Statut → recettes_envoyees ✅`);

    // 7. Déclencher le provisionnement UAT (non bloquant)
    setImmediate(async () => {
      try {
        const { runProvision } = require('./provision-uat');
        console.log(`[auto-onboard] 🚀 Déclenchement provisionnement UAT → ${merchant.processing_id}`);
        const uatResult = await runProvision(merchant.processing_id, 'auto:v1-affiliates');
        if (uatResult.success) {
          console.log(`[auto-onboard] ✅ UAT provisionné — merchantId=${uatResult.merchantId}`);
        } else {
          console.warn(`[auto-onboard] ⚠️  UAT échoué (${uatResult.step}) — ${uatResult.error}`);
        }
      } catch(e2) {
        console.error(`[auto-onboard] ❌ UAT exception:`, e2.message);
      }
    });

  } catch(e) {
    console.error(`[auto-onboard] ❌ ERREUR ${merchant.processing_id}:`, e.message);
    console.error(e.stack);
  }
}

// ── POST /api/v1/affiliates ───────────────────────────────
router.post('/', requireApiToken, async (req, res) => {
  const body = req.body || {};

  // ── Log complet de la requête reçue ──────────────────────
  console.log('\n[API v1] ════════════════════════════════════════════════');
  console.log(`[API v1] 📥 Nouvelle requête POST /api/v1/affiliates`);
  console.log(`[API v1] Token         : ${req.apiToken.nom} (${req.apiToken.token_prefix}...)`);
  console.log(`[API v1] IP            : ${req.ip}`);
  console.log(`[API v1] Auto-onboard  : ${req.apiToken.auto_onboard}`);
  console.log('[API v1] Body reçu (brut) :');
  console.log(JSON.stringify(body, null, 2));
  console.log('[API v1] ════════════════════════════════════════════════\n');

  // Champs normalisés (accepte noms canoniques ET noms Excel)
  const merchantCode   = body.merchant_code   || body.CODE_MARCHAND   || body.PROCESSING_ID || '';
  const companyName    = body.company_name     || body.RAISON_SOCIALE  || body.company       || '';
  const email          = body.email            || body.EMAIL           || '';
  const technicalEmail = body.technical_email  || body.EMAIL_TECHNIQUE || body.Webmaster     || email;
  const terminalId     = body.numero_terminal  || body.TERMINAL_ID     || body.terminal      || '';
  const tradeName      = body.trade_name       || body.NOM_COMMERCIAL  || '';
  const address        = body.address          || body.ADRESSE         || '';
  const city           = body.city             || body.VILLE           || '';
  const postalCode     = body.postal_code      || body.CODE_POSTAL     || body.CDP           || '';
  const phone          = body.phone            || body.TEL             || '';
  const mcc            = body.mcc_code         || body.MCC             || '';
  const website        = body.website || body.SITE_WEB || body.url || body.URL
                      || body.site_url || body.siteUrl || body.SITE_URL
                      || body.web_site || body.WEB_SITE || body.site || '';
  // Filtrer les valeurs email dans l'URL — normaliser avec https:// si absent
  let siteUrl = (website && !website.includes('@')) ? website.trim() : '';
  // Nettoyer format Markdown [texte](url) → url
  const mdMatch = siteUrl.match(/^\[.*?\]\((.+?)\)$/);
  if (mdMatch) siteUrl = mdMatch[1].trim();
  if (siteUrl && !siteUrl.match(/^https?:\/\//i)) siteUrl = 'https://' + siteUrl;
  siteUrl = siteUrl.trim();
  console.log(`[API v1] website extrait : "${website}" → siteUrl="${siteUrl}"`);
  const currency       = body.currency         || body.DEVISE          || '';
  const iban           = body.iban             || body.IBAN            || '';
  const rne            = body.rne              || body.RNE             || '';
  const payfacId       = body.payfac_id        || body.PAYFAC_ID       || null;
  const payfacNom      = body.payfac_nom       || body.PAYFAC_NOM      || null;

  // ── Validation champs obligatoires ───────────────────────
  const missing = [];
  if (!merchantCode.trim()) missing.push('merchant_code');
  if (!companyName.trim())  missing.push('company_name');
  if (!email.trim())        missing.push('email');
  if (!technicalEmail.trim()) missing.push('technical_email');
  if (!siteUrl.trim())      missing.push('website (URL du site marchand requis)');

  if (missing.length) {
    await logApiCall(req.apiToken.id, req.apiToken.token_prefix, '/api/v1/affiliates', 'POST', 400, req.ip,
      `Champs manquants: ${missing.join(',')}`);
    return res.status(400).json({ success:false, error:`Champs obligatoires manquants : ${missing.join(', ')}` });
  }

  // ── Validation payfac_id (UUID v4 si fourni) ─────────────
  let resolvedPayfacId  = null;
  let resolvedPayfacNom = payfacNom || null;
  if (payfacId) {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(payfacId)) {
      return res.status(400).json({ success:false, error:`payfac_id invalide — format UUID attendu` });
    }
    // Vérifier existence en base et récupérer le nom si non fourni
    try {
      const pfRes = await query(`SELECT id, nom FROM payfacs WHERE id=$1 AND actif=true`, [payfacId]);
      if (!pfRes.rows[0]) {
        return res.status(400).json({ success:false, error:`payfac_id inconnu ou inactif : ${payfacId}` });
      }
      resolvedPayfacId  = pfRes.rows[0].id;
      resolvedPayfacNom = payfacNom || pfRes.rows[0].nom;
    } catch(e) {
      // Si la table payfacs n'est pas accessible, on ignore sans bloquer
      resolvedPayfacId  = payfacId;
      resolvedPayfacNom = payfacNom || null;
    }
  }

  const pid = normalizeId(merchantCode);
  if (!pid) {
    return res.status(400).json({ success:false, error:'merchant_code invalide' });
  }

  // ── Vérification doublon en PostgreSQL ────────────────────
  const existing = await query(
    `SELECT processing_id, statut FROM merchants_tracking WHERE processing_id=$1`, [pid]
  );
  if (existing.rows[0]) {
    await logApiCall(req.apiToken.id, req.apiToken.token_prefix, '/api/v1/affiliates', 'POST', 409, req.ip,
      `Doublon: ${pid}`);
    return res.status(409).json({
      success:false,
      error  :`Le marchand ${pid} existe déjà`,
      affiliate_id  : existing.rows[0].processing_id,
      current_status: existing.rows[0].statut,
    });
  }

  // ── Vérification Oracle PROD ──────────────────────────────
  const inProd = await checkOracleProd(pid, req);
  const inTest = await checkOracleTest(pid, req);

  // Déterminer le statut initial selon les règles métier
  // - Oracle PROD → en_production (marchand déjà actif)
  // - Oracle TEST → recettes_envoyees (déjà en test)
  // - Absent partout → en_attente + prise en charge automatique
  let statutInitial;
  let oracleInfo;

  if (inProd === true) {
    statutInitial = 'en_production';
    oracleInfo    = 'Marchand trouvé en Oracle PROD — statut mis à en_production';
  } else if (inTest === true) {
    statutInitial = 'recettes_envoyees';
    oracleInfo    = 'Marchand trouvé en Oracle TEST — statut mis à recettes_envoyees';
  } else {
    statutInitial = 'en_attente';
    oracleInfo    = inProd === null ? 'Oracle PROD non joignable' : 'Nouveau marchand';
  }

  // ── Insertion en base ─────────────────────────────────────
  let newMerchant;
  try {
    // Tentative avec toutes les colonnes (après migration_merchants_extra.sql)
    const result = await query(`
      INSERT INTO merchants_tracking (
        processing_id, raison_sociale, email_contact,
        statut, source, api_token_id, date_import,
        terminal_id, nom_commercial, adresse, ville,
        code_postal, telephone, mcc, site_url, devise, iban, rne,
        payfac_id, payfac_nom
      ) VALUES ($1,$2,$3,$4,'api',$5,NOW(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [pid, companyName.trim(), email.trim() || technicalEmail.trim(),
       statutInitial, req.apiToken.id,
       terminalId || null, tradeName  || null, address    || null,
       city       || null, postalCode || null, phone      || null,
       mcc        || null, siteUrl    || null, currency   || null,
       iban       || null, rne        || null,
       resolvedPayfacId || null, resolvedPayfacNom || null]
    ).catch(async (e1) => {
      // Fallback : INSERT minimal avec les colonnes de base uniquement
      console.warn('[v1-affiliates] Fallback INSERT minimal (migration manquante?):', e1.message);
      return query(`
        INSERT INTO merchants_tracking
          (processing_id, raison_sociale, email_contact, statut, terminal_id, mcc, date_import)
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT (processing_id) DO NOTHING
        RETURNING *`,
        [pid, companyName.trim(), email.trim() || technicalEmail.trim(),
         statutInitial, terminalId || null, mcc || null]
      );
    });
    newMerchant = result.rows[0];
    if (!newMerchant) throw new Error(`Insertion échouée pour ${pid}`);
  } catch(e) {
    await logApiCall(req.apiToken.id, req.apiToken.token_prefix, '/api/v1/affiliates', 'POST', 500, req.ip, e.message);
    return res.status(500).json({ success:false, error:e.message });
  }

  // ── Log succès ────────────────────────────────────────────
  await logApiCall(req.apiToken.id, req.apiToken.token_prefix, '/api/v1/affiliates', 'POST', 201, req.ip,
    `Créé: ${pid} | ${companyName} | statut: ${statutInitial}`);

  // ── Prise en charge automatique si nouveau marchand ───────
  let autoOnboardResult = null;

  console.log(`[v1-affiliates] statut=${statutInitial} | auto_onboard token=${req.apiToken.auto_onboard} | email=${email || technicalEmail}`);

  if (statutInitial === 'en_attente') {
    // auto_onboard peut être true/false/"true"/"false" ou null selon le driver PG
    const doAutoOnboard = req.apiToken.auto_onboard === true
                       || req.apiToken.auto_onboard === 'true'
                       || req.apiToken.auto_onboard === 1;

    if (doAutoOnboard) {
      const merchantForOnboard = {
        processing_id : pid,
        raison_sociale: companyName,
        email_contact : email.trim() || technicalEmail.trim(),
        terminal_id   : terminalId || '',
        mcc           : mcc        || '',
        site_web      : siteUrl    || '',
      };
      console.log(`[v1-affiliates] Déclenchement auto-onboard → ${merchantForOnboard.email_contact}`);
      setImmediate(() => autoPriseEnCharge(merchantForOnboard, req.apiToken.nom));
      autoOnboardResult = 'déclenché en arrière-plan';
    } else {
      console.log(`[v1-affiliates] auto_onboard désactivé sur ce token — pas d'envoi automatique`);
      autoOnboardResult = null;
    }
  }

  // ── Réponse ───────────────────────────────────────────────
  const responseBody = {
    success      : true,
    affiliate_id : pid,
    merchant_code: pid,
    company_name : companyName,
    status       : statutInitial,
    oracle_check : oracleInfo,
    auto_onboard : autoOnboardResult,
    payfac_id    : resolvedPayfacId   || null,
    payfac_nom   : resolvedPayfacNom  || null,
    created_at   : newMerchant.date_import,
    warning      : inProd === null ? 'Oracle PROD non joignable — statut basé sur la vérification locale' : undefined,
  };

  console.log('\n[API v1] ════════════════════════════════════════════════');
  console.log(`[API v1] 📤 Réponse HTTP 201 → ${pid} (${companyName})`);
  console.log(`[API v1] Statut initial   : ${statutInitial}`);
  console.log(`[API v1] Oracle PROD      : ${inProd === true ? '✅ présent' : inProd === false ? '❌ absent' : '⚠️ non joignable'}`);
  console.log(`[API v1] Oracle TEST      : ${inTest === true ? '✅ présent' : inTest === false ? '❌ absent' : '⚠️ non joignable'}`);
  console.log(`[API v1] Auto-onboard     : ${autoOnboardResult || 'désactivé'}`);
  console.log('[API v1] Body réponse :');
  console.log(JSON.stringify(responseBody, null, 2));
  console.log('[API v1] ════════════════════════════════════════════════\n');

  res.status(201).json(responseBody);
});

module.exports = router;
