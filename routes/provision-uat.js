// routes/provision-uat.js
// Provisionnement automatique d'un marchand sur ClicToPay UAT
// Étape 1 : création commerçant via API EPG
// Étape 2 : création terminal via Oracle BPC (SQL)
'use strict';
const express    = require('express');
const router     = express.Router();
const oracledb   = require('oracledb');
const https      = require('https');
const { query }  = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

// ── Configuration UAT ─────────────────────────────────────
const UAT_CFG = {
  // API EPG
  apiUrl   : process.env.UAT_EPG_URL      || 'https://test.clictopay.com/epg/rest/merchant/create.do',
  apiUser  : process.env.UAT_EPG_USER     || 'wissem_2026_op',
  apiPass  : process.env.UAT_EPG_PASSWORD || 'Wissem2026',

  // Champs fixes API
  paymentPageLogin          : 'CLICTOPAY',
  defaultLanguage           : 'FR',
  locales                   : 'FR,EN',
  defaultCurrency           : '788',
  currencies                : ['788'],
  country                   : '788',
  institutionId             : -1,
  mcc_default               : '5999',   // fallback si mcc absent
  options: [
    'PAY_WITHOUT_CVC','VERIFIED_BY_VISA_ALLOWED','PURCHASE_ALLOWED',
    'TRY_SSL_IF_U_IN_ARES_UPI','BINDING_DEACTIVATION_ALLOWED',
    'BINDING_WITHOUT_PAYMENT_ALLOWED','REPLY_3DS_DATA',
    'TRY_SSL_IF_U_IN_RREQ_UPI','NSPK_PAYMENTS_WITH_TIPS','SSL_ALLOWED',
  ],
  paymentAttempts           : 1,
  orderStatusExtendedVersion: 'VERSION_11',
  p2PStatusVersion          : 'VERSION_02',
  threeDSRequestorChallengeInd: '01',
  panMaskedDigitCount       : 6,
  lookupAttempts            : 1,
  allowedBindingType        : 'ALL',

  // Acquirer configs — IDs fixes
  merchantAcquirerConfigs: [{
    id: 3890, acquirerId: 23,
    usedByDefault: true, enabled: true,
    // acqMerchantId et acqTerminalId seront injectés dynamiquement
  }],
  merchantAcquirerPSConfigs: [
    { id: 4772, acquirerId: 23, paymentSystemId: 'MASTERCARD' },
    { id: 4759, acquirerId: 23, paymentSystemId: 'VISA'       },
    // tdsId sera injecté dynamiquement (= processingId)
  ],
  merchantThreedsConfig: [{
    id          : 9713,
    paymentSystemId: 'VISA',
    psEnabled   : true,
    sslEnabled  : true,
    tds1Enabled : false,
    tds2Enabled : false,
    trySslIfUInVeres: false,
    trySslIfUInPares: false,
  }],

  // SQL Oracle — champs fixes
  sql_permissions : '00000010000000000000000000000000000000000000000000000000000000000000000000000000',
  sql_pwd         : '$v2$/oVp9fgy/kery+IVPe/XOCds20h+Jfghh7NUYuBpOOlTX7/QadiOKvCMYATvsUbkwkO1qYzyAkPY0FXNt5dZHQ==',
  sql_salt        : '6f232e92b04a61669d22ac33e5423892a5fdcf42b34288e67dffe101681e17bd',
  sql_institution : -1,
};

// ── Helper : appel HTTPS POST JSON ────────────────────────
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    // Construire un body propre : supprimer uniquement les undefined et null de premier niveau
    const cleanBody = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) cleanBody[k] = v;
    }
    const data    = JSON.stringify(cleanBody);
    const parsed  = new URL(url);
    const options = {
      hostname          : parsed.hostname,
      port              : parsed.port || 443,
      path              : parsed.pathname + parsed.search,
      method            : 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        if (ct.includes('application/json') || raw.trimStart().startsWith('{') || raw.trimStart().startsWith('[')) {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch(e) { reject(new Error(`Réponse JSON invalide (HTTP ${res.statusCode}): ${raw.slice(0, 300)}`)); }
        } else {
          // Réponse HTML ou texte brut — probablement une erreur serveur
          reject(new Error(`Réponse non-JSON (HTTP ${res.statusCode}, Content-Type: ${ct}): ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('Timeout 30s')); });
    req.write(data);
    req.end();
  });
}

// ── Sanitize merchantLogin : espaces → _ , accents supprimés ─
function toLogin(name) {
  return (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // supprimer accents
    .replace(/[^a-zA-Z0-9_\-]/g, '_')                  // caractères spéciaux → _
    .replace(/_+/g, '_')                                // doubles underscores
    .replace(/^_|_$/g, '')                              // trim underscores
    .slice(0, 30)                                       // limite 30 chars
    .toUpperCase();
}

// ══════════════════════════════════════════════════════════
// Fonction principale de provisionnement
// ══════════════════════════════════════════════════════════
async function runProvision(processingId, triggeredBy) {
  const now = new Date();

  // ── Charger le dossier marchand depuis PostgreSQL ──────
  const dossierRes = await query(
    `SELECT processing_id, raison_sociale, terminal_id, mcc, site_url, site_web,
            uat_status, uat_merchant_id
     FROM merchants_tracking WHERE processing_id = $1`,
    [processingId]
  );
  const dossier = dossierRes.rows[0];
  if (!dossier) throw new Error(`Marchand ${processingId} introuvable en base locale`);

  const pid        = dossier.processing_id;
  const terminalId = dossier.terminal_id || '';
  const mcc        = dossier.mcc || UAT_CFG.mcc_default;
  // Normaliser merchantUrl — doit commencer par http:// ou https://
  // Source : colonne site_url (alimentée depuis la colonne URL du fichier Excel BPC)
  const rawSiteUrl = (dossier.site_url || dossier.site_web || '').trim();
  let merchantUrl = rawSiteUrl;
  if (merchantUrl && !merchantUrl.match(/^https?:\/\//i)) {
    merchantUrl = 'https://' + merchantUrl;
  }
  // Valider le format URL — si toujours invalide, on n'envoie pas le champ
  try {
    if (merchantUrl) new URL(merchantUrl);
  } catch(e) {
    console.warn(`[UAT] merchantUrl invalide ignorée : "${merchantUrl}"`);
    merchantUrl = null;
  }
  const login      = toLogin(dossier.raison_sociale);

  // Marquer tentative en cours
  await query(
    `UPDATE merchants_tracking
     SET uat_last_attempt_at = NOW(), uat_error_message = NULL
     WHERE processing_id = $1`, [pid]
  );

  // ────────────────────────────────────────────────────────
  // ÉTAPE 1 — API EPG : création commerçant
  // ────────────────────────────────────────────────────────
  const apiBody = {
    merchantLogin   : login,                  // RAISON_SOCIALE avec espaces → _
    merchantFullName: dossier.raison_sociale, // RAISON SOCIALE exacte

    // ── Tous les champs suivants sont statiques ──────────
    processingId    : '0123456789',
    terminalId      : '01234567',
    merchantUrl     : 'https://www.test.com/',
    externalFraudControlEnabled: false,
    enabled : true,
    deleted : false,
    imported: false,
    mcc     : '7011',
    defaultLanguage: 'FR',
    locales         : 'EN,FR',
    paymentPageLogin: 'CLICTOPAY',
    options: [
      'SECURECODE_ALLOWED',
      'VERIFIED_BY_VISA_ALLOWED',
      'PURCHASE_ALLOWED',
      'CUSTOM_PAYMENT_PAGE',
      'SSL_ALLOWED',
    ],
    useMultiLanguagePaymentPage: true,
    institutionId  : -1,
    currencies     : ['788'],
    defaultCurrency: '788',
    country        : '788',
    showParamListMapping   : [],
    viewableMerchantBindings: [],
    allowedBindingType     : 'ALL',
    privateBindings        : false,
    paymentAttempts        : 1,
    orderStatusExtendedVersion: 'VERSION_11',
    p2PStatusVersion          : 'VERSION_02',
    mustVerify                : false,
    overriddenFraudControlLoginEnabled: false,
    orderStatusPeriodDays  : 0,
    additionalParams       : [],
    callbackOperations     : [],
    inheritSettings        : false,
    submerchantCount       : 0,
    operationsForPayerNotificationEmail   : ['PAYMENT'],
    operationsForMerchantNotificationEmail: [],
    operationsForPayerNotificationSms     : [],
    operationsForMerchantNotificationSms  : [],
    limits          : [],
    allowedCardTypes: [],
    shippingLocationProfile: [],
    suppress3DS     : false,
    merchantAcquirerConfigs: [{
      id           : 3672,
      acquirerId   : 23,
      acqMerchantId: '0123456789',
      acqTerminalId: '01234567',
      usedByDefault: true,
      enabled      : true,
    }],
    merchantAcquirerPSConfigs: [
      { id: 4428, acquirerId: 23, paymentSystemId: 'VISA',       tdsId: '0123456789' },
      { id: 4429, acquirerId: 23, paymentSystemId: 'MASTERCARD', tdsId: '0974530016' },
      { id: 4430, acquirerId: 23, paymentSystemId: 'LOCAL',      tdsId: '0000978850' },
    ],
    merchantRoutingRules  : [],
    avsReversalResultCodes: [],
    avsAutoReversal       : false,
    merchantThreedsConfig: [
      { id: 9385, paymentSystemId: 'VISA',       psEnabled: true, sslEnabled: true, tds1Enabled: false, tds2Enabled: false, trySslIfUInVeres: false, trySslIfUInPares: false },
      { id: 9386, paymentSystemId: 'MASTERCARD', psEnabled: true, sslEnabled: true, tds1Enabled: false, tds2Enabled: false, trySslIfUInVeres: false, trySslIfUInPares: false },
      { id: 9387, paymentSystemId: 'LOCAL',      psEnabled: true, sslEnabled: true, tds1Enabled: false, tds2Enabled: false, trySslIfUInVeres: false, trySslIfUInPares: false },
    ],
    processingFields  : [],
    submerchant       : false,
    googleAnonymousAccessAllowed  : false,
    googlePaymentWithoutCvvAllowed: false,
    merchantCapabilities : [],
    supportedNetworks    : [],
    supportedCountries   : [],
    appleAnonymousAccessAllowed  : false,
    samsungAnonymousAccessAllowed: false,
    mirAnonymousAccessAllowed    : false,
    yandexAnonymousAccessAllowed : false,
    yandexPaySupportedNetworks   : [],
    lookupPaymentSystems : [],
    lookupAttempts       : 1,
    threeDSRequestorChallengeInd : '01',
    visaAdsSupportedNetworks             : [],
    visaAdsSupportedSendersCountries     : [],
    visaAdsSupportedRecepientsCountries  : [],
    psd2scaEnabled       : false,
    psd2ScaMerchantOptions: [],
    scaExemptions        : [],
    merchantPSConfigs    : [],
    panMaskedDigitCount  : 6,
    useSslForLowNspkScoringAResC    : false,
    useSslForLowNspkScoringRReqNOrU : false,
  };

  const apiUrl = `${UAT_CFG.apiUrl}?username=${encodeURIComponent(UAT_CFG.apiUser)}&password=${encodeURIComponent(UAT_CFG.apiPass)}`;

  // ── Log complet du body envoyé à l'API ───────────────
  console.log('\n[UAT] ════════════════════════════════════════════════');
  console.log(`[UAT] 📤 Appel API create.do pour : ${pid} (${dossier.raison_sociale})`);
  console.log('[UAT] URL :', UAT_CFG.apiUrl);
  console.log('[UAT] BODY JSON complet :');
  console.log(JSON.stringify(apiBody, null, 2));
  console.log('[UAT] ════════════════════════════════════════════════\n');

  let apiResp;
  try {
    apiResp = await postJson(apiUrl, apiBody);
  } catch(e) {
    await query(
      `UPDATE merchants_tracking SET uat_status='api_erreur', uat_error_message=$1 WHERE processing_id=$2`,
      [`API timeout/réseau : ${e.message}`, pid]
    );
    return { success:false, step:'api', error: e.message };
  }

  const apiData = apiResp.body;

  if (!apiData || apiData.errorCode !== 0 || !apiData.data?.merchantId) {
    const msg = apiData?.errorMessage || `errorCode=${apiData?.errorCode} (HTTP ${apiResp.status})`;

    // Détecter si le marchand existe déjà sur ClicToPay UAT
    const isAlreadyExists =
      apiData?.errorCode === 1 ||   // code doublon standard
      (apiData?.errorMessage && (
        apiData.errorMessage.toLowerCase().includes('already exist') ||
        apiData.errorMessage.toLowerCase().includes('already registered') ||
        apiData.errorMessage.toLowerCase().includes('login') && apiData.errorMessage.toLowerCase().includes('exist') ||
        apiData.errorMessage.toLowerCase().includes('duplicate') ||
        apiData.errorMessage.toLowerCase().includes('merchantLogin') ||
        apiData.errorMessage.toLowerCase().includes('processingId') && apiData.errorCode === 11
      ));

    const uatStatus = isAlreadyExists ? 'deja_existant' : 'api_erreur';

    await query(
      `UPDATE merchants_tracking SET uat_status=$1, uat_error_message=$2 WHERE processing_id=$3`,
      [uatStatus, msg, pid]
    );
    return { success: false, step: 'api', error: msg, apiResponse: apiData, alreadyExists: isAlreadyExists };
  }

  const merchantId = apiData.data.merchantId;
  console.log(`[UAT] ✅ Étape 1 OK — merchantId=${merchantId} pour ${pid}`);

  // Sauvegarder merchantId + statut intermédiaire
  await query(
    `UPDATE merchants_tracking
     SET uat_merchant_id=$1, uat_status='api_ok', uat_error_message=NULL
     WHERE processing_id=$2`,
    [merchantId, pid]
  );

  // ── Attente propagation Oracle (délai fixe) ─────────
  // L'API EPG crée le marchand de façon asynchrone — on attend 5s avant l'INSERT
  console.log(`[UAT] ⏳ Attente propagation Oracle (5s) avant INSERT BPCUSERTAB...`);
  await new Promise(r => setTimeout(r, 5000));

  // ────────────────────────────────────────────────────────
  // ÉTAPE 2 — Oracle BPC : INSERT BPCUSERTAB
  // ────────────────────────────────────────────────────────
  // Format date identique à l'exemple : 'DD/MM/YYYY HH24:MI:SS'
  const pad2       = n => String(n).padStart(2, '0');
  const nowDate    = new Date();
  const nowStr     = `${pad2(nowDate.getDate())}/${pad2(nowDate.getMonth()+1)}/${nowDate.getFullYear()} ${pad2(nowDate.getHours())}:${pad2(nowDate.getMinutes())}:${pad2(nowDate.getSeconds())}`;
  // LOGIN = terminal_id (identique au Nom d'utilisateur envoyé dans l'email)
  const loginValue = terminalId.trim() || pid;

  // PL/SQL avec TO_DATE explicite et INSTITUTION_ID = -1 hardcodé
  const plsql = `
DECLARE
  v_newID  NUMBER;
  v_maxID  NUMBER;
  v_count  NUMBER;
BEGIN
  SELECT NVL(MAX(ID), 0) INTO v_maxID FROM BPCUSERTAB;
  v_newID := v_maxID + 1;
  LOOP
    SELECT COUNT(*) INTO v_count FROM BPCUSERTAB WHERE ID = v_newID;
    EXIT WHEN v_count = 0;
    v_newID := v_newID + 1;
  END LOOP;

  INSERT INTO BPCUSERTAB (
    ID, LOGIN, PWD, MERCHANT_ID,
    PERMISSIONS_MAP, DEFAULT_LANGUAGE,
    ENABLED, CREATE_DATE, FORCE_PASSWD,
    PASSWORD_CHANGED_DATE, SECURITY_BLOCK_UNTIL,
    SALT, API_TOKEN, LDAP_AUTH, INSTITUTION_ID
  ) VALUES (
    v_newID,
    :login,
    :pwd,
    :merchant_id,
    :permissions,
    'FR',
    1,
    TO_DATE(:create_date, 'DD/MM/YYYY HH24:MI:SS'),
    0,
    TO_DATE(:create_date, 'DD/MM/YYYY HH24:MI:SS'),
    TO_DATE(:create_date, 'DD/MM/YYYY HH24:MI:SS'),
    :salt,
    NULL,
    0,
    -1
  );
  COMMIT;
END;`;

  const bindVars = {
    login       : loginValue,
    pwd         : UAT_CFG.sql_pwd,
    merchant_id : merchantId,
    permissions : UAT_CFG.sql_permissions,
    create_date : nowStr,
    salt        : UAT_CFG.sql_salt,
  };

  // ── Log complet ───────────────────────────────────────
  const sqlFilled = plsql
    .replace(/:login/g,       `'${loginValue}'`)
    .replace(/:pwd/g,         `'${UAT_CFG.sql_pwd}'`)
    .replace(/:merchant_id/g, String(merchantId))
    .replace(/:permissions/g, `'${UAT_CFG.sql_permissions}'`)
    .replace(/:create_date/g, `'${nowStr}'`)
    .replace(/:salt/g,        `'${UAT_CFG.sql_salt}'`);

  console.log('\n════════════════════════════════════════════════════════');
  console.log('[UAT] 📤 BODY API EPG (étape 1) :');
  console.log(JSON.stringify(apiBody, null, 2));
  console.log('\n[UAT] 🗄️  REQUÊTE SQL Oracle (étape 2) :');
  console.log(sqlFilled);
  console.log('════════════════════════════════════════════════════════\n');

  let oConn;
  try {
    oConn = await oracledb.getConnection('merchants_test');

    await oConn.execute(plsql, bindVars);
    console.log(`[UAT] ✅ Étape 2a OK — BPCUSERTAB user API, login=${loginValue}`);

    // ── INSERT 2 : Utilisateur Portail Monitoring (_OP) ──
    const loginOP = loginValue + '_OP';
    const plsqlOP = `
DECLARE
  v_newID  NUMBER;
  v_maxID  NUMBER;
  v_count  NUMBER;
BEGIN
  SELECT NVL(MAX(ID), 0) INTO v_maxID FROM BPCUSERTAB;
  v_newID := v_maxID + 1;
  LOOP
    SELECT COUNT(*) INTO v_count FROM BPCUSERTAB WHERE ID = v_newID;
    EXIT WHEN v_count = 0;
    v_newID := v_newID + 1;
  END LOOP;

  INSERT INTO BPCUSERTAB (
    ID, LOGIN, PWD, MERCHANT_ID,
    PERMISSIONS_MAP, DEFAULT_LANGUAGE,
    ENABLED, CREATE_DATE, FORCE_PASSWD,
    PASSWORD_CHANGED_DATE, SECURITY_BLOCK_UNTIL,
    SALT, API_TOKEN, LDAP_AUTH, INSTITUTION_ID
  ) VALUES (
    v_newID,
    :login,
    :pwd,
    :merchant_id,
    :permissions,
    'FR',
    1,
    TO_DATE(:create_date, 'DD/MM/YYYY HH24:MI:SS'),
    0,
    TO_DATE(:create_date, 'DD/MM/YYYY HH24:MI:SS'),
    TO_DATE(:create_date, 'DD/MM/YYYY HH24:MI:SS'),
    :salt,
    NULL,
    0,
    -1
  );
  COMMIT;
END;`;

    const bindVarsOP = {
      login       : loginOP,
      pwd         : UAT_CFG.sql_pwd,          // même mot de passe (envoyé dans email monitoring)
      merchant_id : merchantId,
      permissions : '00000000000000000000000000000000000000000000000000000000000000000000000000000000',
      create_date : nowStr,
      salt        : UAT_CFG.sql_salt,
    };

    const sqlFilledOP = plsqlOP
      .replace(/:login/g,       `'${loginOP}'`)
      .replace(/:pwd/g,         `'${UAT_CFG.sql_pwd}'`)
      .replace(/:merchant_id/g, String(merchantId))
      .replace(/:permissions/g, `'00000000000000000000000000000000000000000000000000000000000000000000000000000000'`)
      .replace(/:create_date/g, `'${nowStr}'`)
      .replace(/:salt/g,        `'${UAT_CFG.sql_salt}'`);

    console.log('\n[UAT] 🗄️  REQUÊTE SQL Oracle (étape 2b — utilisateur _OP) :');
    console.log(sqlFilledOP);

    await oConn.execute(plsqlOP, bindVarsOP);
    console.log(`[UAT] ✅ Étape 2b OK — BPCUSERTAB user Monitoring, login=${loginOP}`);

    // Marquer provisionnement complet
    await query(
      `UPDATE merchants_tracking
       SET uat_status='provisionne', uat_provisioned_at=NOW(), uat_error_message=NULL
       WHERE processing_id=$1`,
      [pid]
    );

    return {
      success   : true,
      merchantId,
      login     : terminalId || pid,
      apiResponse: apiData,
    };

  } catch(sqlErr) {
    console.error(`[UAT] ❌ Étape 2 ÉCHOUÉE pour ${pid}:`, sqlErr.message);
    // Garder merchantId en base pour retry manuel
    await query(
      `UPDATE merchants_tracking
       SET uat_status='sql_erreur', uat_error_message=$1
       WHERE processing_id=$2`,
      [`SQL Oracle : ${sqlErr.message}`, pid]
    );
    return {
      success   : false,
      step      : 'sql',
      merchantId,      // conservé pour retry
      error     : sqlErr.message,
    };
  } finally {
    if (oConn) { try { await oConn.close(); } catch(_){} }
  }
}

// ══════════════════════════════════════════════════════════
// POST /api/provision-uat/:processing_id
// Déclenchement manuel (ou retry)
// ══════════════════════════════════════════════════════════
router.post('/:processing_id', requireAuth, async (req, res) => {
  const pid = req.params.processing_id;
  if (!pid) return res.status(400).json({ success:false, error:'processing_id requis' });

  // Vérifier si déjà provisionné (sauf si retry forcé)
  const existing = await query(
    `SELECT uat_status, uat_merchant_id FROM merchants_tracking WHERE processing_id=$1`,
    [pid]
  ).catch(() => ({ rows:[] }));

  const current = existing.rows[0];
  const forceRetry = req.query.retry === 'true' || req.body.retry === true;

  if (current?.uat_status === 'provisionne' && !forceRetry) {
    return res.status(409).json({
      success    : false,
      error      : 'Marchand déjà provisionné sur UAT',
      merchantId : current.uat_merchant_id,
      hint       : 'Ajoutez ?retry=true pour forcer le re-provisionnement',
    });
  }

  // Si api_ok (étape1 faite, SQL raté) → sauter étape 1 et ne refaire que le SQL
  if (current?.uat_status === 'api_ok' && !forceRetry && current.uat_merchant_id) {
    console.log(`[UAT] ♻️  Retry SQL uniquement pour ${pid} (merchantId=${current.uat_merchant_id})`);
    const sqlResult = await retrySqlOnly(pid, current.uat_merchant_id);
    await logAction(req, 'UAT_PROVISION_SQL_RETRY', `merchant:${pid}`, sqlResult);
    return res.json(sqlResult);
  }

  try {
    const result = await runProvision(pid, req.user?.email || 'manual');
    await logAction(req, 'UAT_PROVISION', `merchant:${pid}`, {
      triggeredBy: 'manual',
      ...result
    });
    return res.json(result);
  } catch(e) {
    console.error('[UAT provision]', e.message);
    return res.status(500).json({ success:false, error: e.message });
  }
});

// ── Retry SQL uniquement (étape 2 seulement) ──────────────
async function retrySqlOnly(pid, merchantId) {
  const dossierRes = await query(
    `SELECT terminal_id, processing_id FROM merchants_tracking WHERE processing_id=$1`, [pid]
  );
  const d = dossierRes.rows[0];
  if (!d) return { success:false, error:'Marchand introuvable' };

  const login = d.terminal_id || d.processing_id;
  let oConn;
  try {
    oConn = await oracledb.getConnection('merchants_test');
    await oConn.execute(`
DECLARE
  v_newID NUMBER; v_maxID NUMBER; v_count NUMBER;
BEGIN
  SELECT NVL(MAX(ID),0) INTO v_maxID FROM BPCUSERTAB;
  v_newID := v_maxID + 1;
  LOOP
    SELECT COUNT(*) INTO v_count FROM BPCUSERTAB WHERE ID=v_newID;
    EXIT WHEN v_count=0;
    v_newID := v_newID+1;
  END LOOP;
  INSERT INTO BPCUSERTAB (ID,LOGIN,PWD,MERCHANT_ID,PERMISSIONS_MAP,DEFAULT_LANGUAGE,
    ENABLED,CREATE_DATE,FORCE_PASSWD,PASSWORD_CHANGED_DATE,SECURITY_BLOCK_UNTIL,
    SALT,API_TOKEN,LDAP_AUTH,INSTITUTION_ID)
  VALUES (v_newID,:login,:pwd,:merchant_id,:permissions,'FR',1,:create_date,0,
    :create_date,:create_date,:salt,NULL,0,:institution_id);
  COMMIT;
END;`, {
      login       : (d.terminal_id && d.terminal_id.trim()) ? d.terminal_id.trim() : d.processing_id,
      pwd         : UAT_CFG.sql_pwd,
      merchant_id : merchantId,
      permissions : UAT_CFG.sql_permissions,
      create_date : new Date(),
      salt        : UAT_CFG.sql_salt,
      institution_id: UAT_CFG.sql_institution,
    });

    // INSERT utilisateur _OP (retry)
    const loginOP2 = login + '_OP';
    await oConn.execute(`
DECLARE
  v_newID NUMBER; v_maxID NUMBER; v_count NUMBER;
BEGIN
  SELECT NVL(MAX(ID),0) INTO v_maxID FROM BPCUSERTAB;
  v_newID := v_maxID + 1;
  LOOP SELECT COUNT(*) INTO v_count FROM BPCUSERTAB WHERE ID=v_newID; EXIT WHEN v_count=0; v_newID:=v_newID+1; END LOOP;
  INSERT INTO BPCUSERTAB (ID,LOGIN,PWD,MERCHANT_ID,PERMISSIONS_MAP,DEFAULT_LANGUAGE,ENABLED,CREATE_DATE,FORCE_PASSWD,PASSWORD_CHANGED_DATE,SECURITY_BLOCK_UNTIL,SALT,API_TOKEN,LDAP_AUTH,INSTITUTION_ID)
  VALUES (v_newID,:login,:pwd,:merchant_id,:permissions,'FR',1,TO_DATE(:create_date,'DD/MM/YYYY HH24:MI:SS'),0,TO_DATE(:create_date,'DD/MM/YYYY HH24:MI:SS'),TO_DATE(:create_date,'DD/MM/YYYY HH24:MI:SS'),:salt,NULL,0,-1);
  COMMIT;
END;`, {
      login       : loginOP2,
      pwd         : UAT_CFG.sql_pwd,
      merchant_id : merchantId,
      permissions : '00000000000000000000000000000000000000000000000000000000000000000000000000000000',
      create_date : (() => { const p=n=>String(n).padStart(2,'0'),d=new Date(); return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); })(),
      salt        : UAT_CFG.sql_salt,
    });
    console.log(`[UAT] ✅ Retry 2b OK — BPCUSERTAB user Monitoring, login=${loginOP2}`);

    await query(
      `UPDATE merchants_tracking SET uat_status='provisionne', uat_provisioned_at=NOW(), uat_error_message=NULL WHERE processing_id=$1`,
      [pid]
    );
    return { success:true, merchantId, login, retried_step:'sql' };
  } catch(e) {
    await query(
      `UPDATE merchants_tracking SET uat_status='sql_erreur', uat_error_message=$1 WHERE processing_id=$2`,
      [`Retry SQL : ${e.message}`, pid]
    );
    return { success:false, step:'sql', merchantId, error: e.message };
  } finally {
    if (oConn) { try { await oConn.close(); } catch(_){} }
  }
}

module.exports = router;
module.exports.runProvision = runProvision;
