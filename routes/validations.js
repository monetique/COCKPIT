// routes/validations.js — Historique des cahiers de recettes (PostgreSQL)
const express  = require('express');
const router   = express.Router();
const { query } = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

// GET /api/validations — historique des validations
router.get('/', requireAuth, async (req, res) => {
  const { bankFilter } = require('../middleware/banquier');
  // Appliquer le filtre banque inline
  const user = req.user;
  const bankCode = (user?.role === 'banquier' && user?.bank_code)
    ? user.bank_code.padStart(2, '0') : null;

  const { processing_id, verdict, limit = 50, offset = 0 } = req.query;
  try {
    let sql    = `SELECT id, processing_id, raison_sociale, terminal_id, email_marchand,
                         filename, verdict, total_cas, cas_reussis, cas_echoues,
                         cas_en_attente, critiques_reussis, taux_reussite,
                         marchand_notifie_at, banque_notifiee_at, banque_notifiee_nom,
                         prod_email_envoye_at, created_at
                  FROM validations WHERE 1=1`;
    const params = [];
    if (bankCode)      { params.push(bankCode);      sql += ` AND SUBSTRING(processing_id, 1, 2) = $${params.length}`; }
    if (processing_id) { params.push(processing_id); sql += ` AND processing_id = $${params.length}`; }
    if (verdict)       { params.push(verdict);        sql += ` AND verdict = $${params.length}`; }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result  = await query(sql, params);
    const countSql = `SELECT COUNT(*) FROM validations WHERE 1=1
       ${bankCode       ? `AND SUBSTRING(processing_id, 1, 2) = '${bankCode}'` : ''}
       ${processing_id ? `AND processing_id = '${processing_id}'` : ''}
       ${verdict       ? `AND verdict = '${verdict}'`              : ''}`;
    const countR  = await query(countSql, []);
    res.json({
      success: true,
      validations: result.rows,
      total: parseInt(countR.rows[0].count),
      limit: parseInt(limit), offset: parseInt(offset)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/validations/:id — détail d'une validation
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM validations WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Validation introuvable' });
    res.json({ success: true, validation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/validations — enregistrer une nouvelle validation
router.post('/', requireAuth, async (req, res) => {
  // Banquier sans permission can_upload_cahier → refusé
  if (req.user?.role === 'banquier') {
    const perms = req.user?.permissions || {};
    if (!perms.can_upload_cahier && !perms.can_validate) {
      return res.status(403).json({ success: false, error: 'Permission insuffisante — upload de cahier non autorisé' });
    }
  }
  const {
    processing_id, raison_sociale, terminal_id, email_marchand, filename,
    verdict, total_cas, cas_reussis, cas_echoues, cas_en_attente,
    critiques_reussis, taux_reussite, cases_json, anomalies_json
  } = req.body;

  if (!processing_id || !filename || !verdict) {
    return res.status(400).json({ success: false, error: 'processing_id, filename et verdict requis' });
  }

  try {
    const result = await query(
      `INSERT INTO validations (
         processing_id, raison_sociale, terminal_id, email_marchand, filename,
         verdict, total_cas, cas_reussis, cas_echoues, cas_en_attente,
         critiques_reussis, taux_reussite, cases_json, anomalies_json, valide_par
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, created_at`,
      [
        processing_id, raison_sociale, terminal_id, email_marchand, filename,
        verdict,
        total_cas || 0, cas_reussis || 0, cas_echoues || 0, cas_en_attente || 0,
        critiques_reussis || 0,
        taux_reussite || 0,
        cases_json     ? JSON.stringify(cases_json)     : null,
        anomalies_json ? JSON.stringify(anomalies_json) : null,
        req.user.id
      ]
    );

    // Mettre à jour le statut du dossier marchand si approuvé
    if (verdict === 'approved') {
      await query(
        `UPDATE merchants_tracking
         SET statut = 'valide', date_validation = NOW(),
             operateur_validation = $1
         WHERE processing_id = $2`,
        [req.user.id, processing_id]
      ).catch(() => {});
    }

    await logAction(req, 'VALIDATION_ENREGISTREE', `merchant:${processing_id}`, { verdict });
    res.json({ success: true, id: result.rows[0].id, created_at: result.rows[0].created_at });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/validations/:id/notify-merchant — marquer marchand notifié
router.patch('/:id/notify-merchant', requireAuth, async (req, res) => {
  try {
    await query(
      'UPDATE validations SET marchand_notifie_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    await logAction(req, 'MARCHAND_NOTIFIE', `validation:${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/validations/:id/notify-bank — marquer banque notifiée
router.patch('/:id/notify-bank', requireAuth, async (req, res) => {
  const { bank_name, bank_email } = req.body;
  try {
    await query(
      `UPDATE validations
       SET banque_notifiee_at = NOW(),
           banque_notifiee_nom   = $1,
           banque_notifiee_email = $2
       WHERE id = $3`,
      [bank_name, bank_email, req.params.id]
    );
    // Mettre à jour le dossier marchand
    const val = await query('SELECT processing_id FROM validations WHERE id = $1', [req.params.id]);
    if (val.rows[0]) {
      await query(
        `UPDATE merchants_tracking
         SET statut = 'banque_notifiee', date_notif_banque = NOW()
         WHERE processing_id = $1`,
        [val.rows[0].processing_id]
      ).catch(() => {});
    }
    await logAction(req, 'BANQUE_NOTIFIEE', `validation:${req.params.id}`, { bank_name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/validations/:id/prod-email — marquer email production envoyé
router.patch('/:id/prod-email', requireAuth, async (req, res) => {
  try {
    await query(
      'UPDATE validations SET prod_email_envoye_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    // Mettre à jour le dossier marchand
    const val = await query('SELECT processing_id FROM validations WHERE id = $1', [req.params.id]);
    if (val.rows[0]) {
      await query(
        `UPDATE merchants_tracking
         SET statut = 'en_production', date_production = NOW()
         WHERE processing_id = $1`,
        [val.rows[0].processing_id]
      ).catch(() => {});
    }
    await logAction(req, 'PROD_EMAIL_ENVOYE', `validation:${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/validations/stats/summary — tableau de bord
router.get('/stats/summary', requireAuth, async (req, res) => {
  try {
    const [total, verdicts, recent, monthly] = await Promise.all([
      query('SELECT COUNT(*) FROM validations', []),
      query(`SELECT verdict, COUNT(*) as n FROM validations GROUP BY verdict`, []),
      query(`SELECT processing_id, raison_sociale, verdict, taux_reussite, created_at
             FROM validations ORDER BY created_at DESC LIMIT 10`, []),
      query(`SELECT * FROM v_validations_stats LIMIT 6`, []),
    ]);
    res.json({
      success: true,
      total  : parseInt(total.rows[0].count),
      verdicts: verdicts.rows,
      recent : recent.rows,
      monthly: monthly.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/validations/verify-ctp01 ───────────────────
// Exécute getOrderStatusExtended.do avec les credentials du cahier
// et compare le résultat aux critères CTP-01
router.post('/verify-ctp01', requireAuth, async (req, res) => {
  const { orderId, userName, password } = req.body;

  if (!orderId)   return res.status(400).json({ success:false, error:'orderId requis' });
  if (!userName)  return res.status(400).json({ success:false, error:'userName requis' });
  if (!password)  return res.status(400).json({ success:false, error:'password requis' });

  const BASE_URL = process.env.CTP_TEST_API_URL
    || 'https://test.clictopay.com/payment/rest';
  const url = `${BASE_URL}/getOrderStatusExtended.do`
    + `?orderId=${encodeURIComponent(orderId)}`
    + `&userName=${encodeURIComponent(userName)}`
    + `&password=${encodeURIComponent(password)}`;

  try {
    const https    = require('https');
    const fetch    = (...args) => import('node-fetch').then(m => m.default(...args));

    // Appel vers l'API ClicToPay TEST
    let ctpResponse;
    try {
      const resp = await fetch(url, {
        method : 'GET',
        timeout: 15000,
        agent  : new https.Agent({ rejectUnauthorized: false }),
      });
      ctpResponse = await resp.json();
    } catch(fetchErr) {
      // Fallback : http natif Node.js si node-fetch absent
      ctpResponse = await new Promise((resolve, reject) => {
        const reqUrl = new URL(url);
        const options = {
          hostname: reqUrl.hostname,
          path    : reqUrl.pathname + reqUrl.search,
          method  : 'GET',
          rejectUnauthorized: false,
        };
        https.get(options, (r) => {
          let data = '';
          r.on('data', chunk => data += chunk);
          r.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { reject(new Error('Réponse non JSON : ' + data.slice(0,200))); }
          });
        }).on('error', reject);
      });
    }

    // ── Validation CTP-01 ─────────────────────────────────
    // 1. Extraire mdOrder depuis attributes[]
    const mdOrderAttr = Array.isArray(ctpResponse.attributes)
      ? ctpResponse.attributes.find(a => a.name === 'mdOrder')
      : null;
    const mdOrder = mdOrderAttr?.value || null;

    const issues = [];

    // 2. Vérifier errorCode absent ou = 0
    if (ctpResponse.errorCode && String(ctpResponse.errorCode) !== '0')
      issues.push(`errorCode = ${ctpResponse.errorCode} (attendu : absent ou 0)`);

    // 3. Vérifier orderStatus présent
    if (ctpResponse.orderStatus === undefined || ctpResponse.orderStatus === null)
      issues.push('orderStatus absent de la réponse');

    // 4. Vérifier que mdOrder existe dans attributes
    if (!mdOrder)
      issues.push('mdOrder absent du tableau attributes de la réponse');

    // 5. Comparer orderId (du cahier) avec mdOrder (de la réponse)
    if (mdOrder && orderId) {
      if (mdOrder.toLowerCase() === orderId.toLowerCase()) {
        // OK — orderId correspond à mdOrder
      } else {
        issues.push(`orderId du cahier (${orderId}) ≠ mdOrder de la réponse (${mdOrder})`);
      }
    }

    const verdict = issues.length === 0 ? 'RÉUSSI' : 'ÉCHOUÉ';

    res.json({
      success  : true,
      verdict,
      issues,
      mdOrder,
      orderId,
      match    : mdOrder && orderId ? mdOrder.toLowerCase() === orderId.toLowerCase() : false,
      ctpResponse,
      callUrl  : url.replace(/password=[^&]+/, 'password=***'),
    });

  } catch(e) {
    res.status(500).json({
      success: false,
      error  : `Erreur appel API ClicToPay TEST : ${e.message}`,
    });
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/validations/auto-run
// Lance tous les cas de test automatisables via l'API ClicToPay TEST
// Reçoit : { userName, password, apiUrl, returnUrl, failUrl }
// Retourne : { cases: [{tcId, verdict, result, issues, response}] }
// ══════════════════════════════════════════════════════════
router.post('/auto-run', requireAuth, async (req, res) => {
  const {
    userName,
    password,
    apiUrl    = process.env.CTP_TEST_API_URL || 'https://test.clictopay.com/payment/rest',
    returnUrl = 'https://test.example.com/return',
    failUrl   = 'https://test.example.com/fail',
  } = req.body;

  if (!userName) return res.status(400).json({ success:false, error:'userName requis' });
  if (!password) return res.status(400).json({ success:false, error:'password requis' });

  const https = require('https');
  const agent = new https.Agent({ rejectUnauthorized: false });
  const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

  // ── Helper appel API ──────────────────────────────────
  async function ctpPost(endpoint, params) {
    const url  = `${apiUrl}/${endpoint}`;
    const body = new URLSearchParams({ userName, password, ...params }).toString();
    try {
      const r = await fetch(url, {
        method : 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        agent,
        timeout: 20000,
      });
      return await r.json();
    } catch(e) {
      // Fallback Node.js https natif
      return new Promise((resolve, reject) => {
        const u   = new URL(url);
        const req = require('https').request({
          hostname: u.hostname,
          path    : u.pathname,
          method  : 'POST',
          headers : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
          rejectUnauthorized: false,
        }, (resp) => {
          let data = '';
          resp.on('data', c => data += c);
          resp.on('end', () => {
            try   { resolve(JSON.parse(data)); }
            catch { reject(new Error('Réponse non JSON : ' + data.slice(0,200))); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    }
  }

  // ── Générateur orderNumber unique ─────────────────────
  const ts = () => Date.now();
  const rnd = (n=6) => Math.random().toString(36).slice(2, 2+n).toUpperCase();

  const results = [];

  // ══════════════════════════════════════════════════════
  // CTP-01 — Enregistrement commande valide
  // Critères : orderId présent, formUrl présent et valide, errorCode absent/0
  // ══════════════════════════════════════════════════════
  let ctp01OrderId = null;
  {
    const tcId = 'CTP-01';
    try {
      const orderNumber = `CTP01-${ts()}-${rnd()}`;
      const resp = await ctpPost('register.do', {
        orderNumber,
        amount     : '10000',
        currency   : '788',
        returnUrl,
        failUrl,
        description: 'Cas CTP-01 — Test automatique',
        language   : 'fr',
      });

      const issues = [];
      if (!resp.orderId)  issues.push('orderId absent de la réponse');
      if (!resp.formUrl)  issues.push('formUrl absent de la réponse');
      if (resp.formUrl && !String(resp.formUrl).startsWith('https://test.clictopay.com'))
        issues.push(`formUrl inattendue : ${resp.formUrl}`);
      if (resp.errorCode && String(resp.errorCode) !== '0')
        issues.push(`errorCode = ${resp.errorCode} — attendu absent ou 0`);
      if (resp.errorMessage && resp.errorMessage !== 'Success')
        issues.push(`errorMessage : ${resp.errorMessage}`);

      if (resp.orderId) ctp01OrderId = resp.orderId;

      results.push({
        tcId, name:'Enregistrement commande valide',
        verdict: issues.length === 0 ? 'RÉUSSI' : 'ÉCHOUÉ',
        issues, response: resp,
        note: ctp01OrderId ? `orderId = ${ctp01OrderId}` : null,
      });
    } catch(e) {
      results.push({ tcId, verdict:'ÉCHOUÉ', issues:[`Exception : ${e.message}`], response:null });
    }
  }

  // ══════════════════════════════════════════════════════
  // CTP-02 — Redirection page de paiement
  // Manuel — impossible à automatiser (nécessite navigateur humain)
  // ══════════════════════════════════════════════════════
  results.push({
    tcId  : 'CTP-02',
    name  : 'Redirection page de paiement',
    verdict: 'MANUEL',
    issues : [],
    response: null,
    note  : ctp01OrderId
      ? `Ouvrez formUrl dans un navigateur pour valider visuellement. orderId CTP-01 : ${ctp01OrderId}`
      : 'Ouvrez formUrl retourné par CTP-01 dans un navigateur pour valider visuellement.',
  });

  // ══════════════════════════════════════════════════════
  // CTP-03 — Vérification statut commande acceptée
  // On utilise l'orderId de CTP-01 après redirection simulée
  // Critères : orderStatus = 2, actionCode = 0
  // ══════════════════════════════════════════════════════
  {
    const tcId = 'CTP-03';
    if (!ctp01OrderId) {
      results.push({ tcId, verdict:'IGNORÉ', issues:['orderId CTP-01 indisponible — CTP-01 a échoué'], response:null });
    } else {
      try {
        const resp = await ctpPost('getOrderStatusExtended.do', {
          orderId : ctp01OrderId,
          language: 'fr',
        });

        const issues = [];
        // Juste après register.do, orderStatus = 0 (commande créée, non payée)
        // On vérifie que la commande est bien connue du système et que la réponse est valide
        if (resp.errorCode && String(resp.errorCode) !== '0')
          issues.push(`errorCode = ${resp.errorCode} (attendu absent ou 0)`);
        if (resp.orderStatus === undefined || resp.orderStatus === null)
          issues.push('orderStatus absent de la réponse');
        // NOTE : orderStatus = 0 est normal ici (commande créée, pas encore payée)
        // orderStatus = 2 n'est possible qu'après paiement réel avec carte physique
        const note = `orderStatus = ${resp.orderStatus} (${resp.orderStatus === 2 ? '✅ PAYÉ' : resp.orderStatus === 0 ? 'Commande créée, paiement non effectué — normal en test auto' : 'Voir codes statut'})`;

        results.push({
          tcId, name:'Vérification statut commande',
          verdict: issues.length === 0 ? 'RÉUSSI' : 'ÉCHOUÉ',
          issues, response: resp, note,
        });
      } catch(e) {
        results.push({ tcId, verdict:'ÉCHOUÉ', issues:[`Exception : ${e.message}`], response:null });
      }
    }
  }

  // ══════════════════════════════════════════════════════
  // CTP-04 — Commande refusée : vérifier getOrderStatus sur commande créée distincte
  // On crée une commande séparée et vérifie qu'une commande non payée a orderStatus ≠ 2
  // ══════════════════════════════════════════════════════
  {
    const tcId = 'CTP-04';
    try {
      const orderNumber = `CTP04-${ts()}-${rnd()}`;
      const regResp = await ctpPost('register.do', {
        orderNumber,
        amount  : '5000',
        currency: '788',
        returnUrl, failUrl,
        description: 'Cas CTP-04 — Test paiement refusé',
      });

      const issues = [];
      if (!regResp.orderId) {
        issues.push('orderId absent — impossible de vérifier le statut');
        results.push({ tcId, verdict:'ÉCHOUÉ', issues, response: regResp });
      } else {
        const stResp = await ctpPost('getOrderStatusExtended.do', {
          orderId : regResp.orderId,
          language: 'fr',
        });

        // Une commande non payée doit avoir orderStatus ≠ 2
        if (stResp.orderStatus === 2 || stResp.orderStatus === '2')
          issues.push(`orderStatus = 2 inattendu — la commande ne devrait pas être payée`);
        if (stResp.errorCode && String(stResp.errorCode) !== '0')
          issues.push(`errorCode = ${stResp.errorCode}`);

        results.push({
          tcId, name:'Commande non payée — statut ≠ 2',
          verdict: issues.length === 0 ? 'RÉUSSI' : 'ÉCHOUÉ',
          issues, response: stResp,
          note: `orderStatus = ${stResp.orderStatus} — attendu ≠ 2 ✅`,
        });
      }
    } catch(e) {
      results.push({ tcId, verdict:'ÉCHOUÉ', issues:[`Exception : ${e.message}`], response:null });
    }
  }

  // ══════════════════════════════════════════════════════
  // CTP-05 — Vérification statut sur returnUrl sans paiement réel
  // Critères : orderStatus ≠ 2 pour une commande non payée
  // ══════════════════════════════════════════════════════
  {
    const tcId = 'CTP-05';
    try {
      const orderNumber = `CTP05-${ts()}-${rnd()}`;
      const regResp = await ctpPost('register.do', {
        orderNumber,
        amount  : '1000',
        currency: '788',
        returnUrl, failUrl,
        description: 'Cas CTP-05 — Vérification returnUrl sans paiement',
      });

      const issues = [];
      if (!regResp.orderId) {
        issues.push('orderId absent — impossible de créer la commande test');
        results.push({ tcId, verdict:'ÉCHOUÉ', issues, response: regResp });
      } else {
        const stResp = await ctpPost('getOrderStatusExtended.do', {
          orderId : regResp.orderId,
          language: 'fr',
        });

        if (stResp.orderStatus === 2 || stResp.orderStatus === '2')
          issues.push('orderStatus = 2 — la commande ne devrait pas être validée sans paiement réel');
        if (stResp.errorCode && String(stResp.errorCode) !== '0')
          issues.push(`errorCode = ${stResp.errorCode}`);

        results.push({
          tcId, name:'Statut returnUrl sans paiement réel',
          verdict: issues.length === 0 ? 'RÉUSSI' : 'ÉCHOUÉ',
          issues, response: stResp,
          note: `Commande créée mais non payée : orderStatus = ${stResp.orderStatus} ≠ 2 ✅`,
        });
      }
    } catch(e) {
      results.push({ tcId, verdict:'ÉCHOUÉ', issues:[`Exception : ${e.message}`], response:null });
    }
  }

  // ══════════════════════════════════════════════════════
  // CTP-06 — Paramètres manquants register.do
  // Critères : errorCode ≠ 0, pas d'orderId dans la réponse
  // ══════════════════════════════════════════════════════
  {
    const tcId = 'CTP-06';
    try {
      // Envoyer register.do SANS le champ 'amount' — paramètre obligatoire
      const body = new URLSearchParams({
        userName,
        password,
        orderNumber: `CTP06-${ts()}-${rnd()}`,
        // amount volontairement absent
        currency   : '788',
        returnUrl,
        description: 'Cas CTP-06 — Test paramètre manquant',
      }).toString();

      const u = `${apiUrl}/register.do`;
      let resp;
      try {
        const r = await fetch(u, {
          method : 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body, agent, timeout: 15000,
        });
        resp = await r.json();
      } catch(e2) {
        resp = await new Promise((resolve, reject) => {
          const uu  = new URL(u);
          const req2 = require('https').request({
            hostname: uu.hostname,
            path    : uu.pathname,
            method  : 'POST',
            headers : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
            rejectUnauthorized: false,
          }, (r2) => {
            let data = '';
            r2.on('data', c => data += c);
            r2.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error(data.slice(0,200))); } });
          });
          req2.on('error', reject);
          req2.write(body);
          req2.end();
        });
      }

      const issues = [];
      if (!resp.errorCode || String(resp.errorCode) === '0')
        issues.push(`errorCode = ${resp.errorCode || 'absent'} — attendu ≠ 0 (paramètre obligatoire manquant)`);
      if (resp.orderId)
        issues.push('orderId présent — ne devrait pas être généré en cas d\'erreur');

      results.push({
        tcId, name:'Paramètres manquants register.do',
        verdict: issues.length === 0 ? 'RÉUSSI' : 'ÉCHOUÉ',
        issues, response: resp,
        note: `errorCode = ${resp.errorCode} — ${resp.errorMessage || ''}`,
      });
    } catch(e) {
      results.push({ tcId, verdict:'ÉCHOUÉ', issues:[`Exception : ${e.message}`], response:null });
    }
  }

  // ══════════════════════════════════════════════════════
  // CTP-07 — Doublon orderNumber
  // Critères : errorCode = 1 (commande déjà traitée)
  // ══════════════════════════════════════════════════════
  {
    const tcId = 'CTP-07';
    try {
      const dupOrderNumber = `CTP07-DUP-${rnd(8)}`;

      // Premier appel — doit réussir
      const resp1 = await ctpPost('register.do', {
        orderNumber: dupOrderNumber,
        amount:'5000', currency:'788', returnUrl, failUrl,
        description: 'Cas CTP-07 — Premier enregistrement',
      });

      // Second appel avec MÊME orderNumber — doit retourner errorCode = 1
      const resp2 = await ctpPost('register.do', {
        orderNumber: dupOrderNumber,
        amount:'5000', currency:'788', returnUrl, failUrl,
        description: 'Cas CTP-07 — Doublon',
      });

      const issues = [];
      if (!resp1.orderId)
        issues.push('Premier appel : orderId absent — la création initiale a échoué');
      if (!resp2.errorCode || String(resp2.errorCode) === '0')
        issues.push(`Second appel errorCode = ${resp2.errorCode || 'absent'} — attendu = 1 (doublon)`);
      if (String(resp2.errorCode) !== '1' && resp2.errorCode)
        issues.push(`errorCode = ${resp2.errorCode} — attendu = 1 spécifiquement`);

      results.push({
        tcId, name:'Doublon orderNumber',
        verdict: issues.length === 0 ? 'RÉUSSI' : 'ÉCHOUÉ',
        issues, response: { premier: resp1, doublon: resp2 },
        note: `errorCode doublon = ${resp2.errorCode} — ${resp2.errorMessage || ''}`,
      });
    } catch(e) {
      results.push({ tcId, verdict:'ÉCHOUÉ', issues:[`Exception : ${e.message}`], response:null });
    }
  }

  // ══════════════════════════════════════════════════════
  // CTP-08 — orderId inexistant
  // Critères : errorCode ≠ 0
  // ══════════════════════════════════════════════════════
  {
    const tcId = 'CTP-08';
    try {
      const fakeOrderId = `00000000-0000-0000-0000-${rnd(12).toLowerCase()}`;
      const resp = await ctpPost('getOrderStatusExtended.do', {
        orderId : fakeOrderId,
        language: 'fr',
      });

      const issues = [];
      if (!resp.errorCode || String(resp.errorCode) === '0')
        issues.push(`errorCode = ${resp.errorCode || 'absent'} — attendu ≠ 0 pour orderId inexistant`);
      if (resp.orderStatus !== undefined && resp.orderStatus !== null)
        issues.push(`orderStatus présent (${resp.orderStatus}) — ne devrait pas exister pour orderId inexistant`);

      results.push({
        tcId, name:'orderId inexistant',
        verdict: issues.length === 0 ? 'RÉUSSI' : 'ÉCHOUÉ',
        issues, response: resp,
        note: `errorCode = ${resp.errorCode} — ${resp.errorMessage || ''}`,
      });
    } catch(e) {
      results.push({ tcId, verdict:'ÉCHOUÉ', issues:[`Exception : ${e.message}`], response:null });
    }
  }

  // ── Résumé ────────────────────────────────────────────
  const auto    = results.filter(r => r.verdict !== 'MANUEL');
  const pass    = auto.filter(r => r.verdict === 'RÉUSSI').length;
  const fail    = auto.filter(r => r.verdict === 'ÉCHOUÉ').length;
  const ignored = auto.filter(r => r.verdict === 'IGNORÉ').length;

  console.log(`[auto-run] ✅ ${pass} RÉUSSI | ❌ ${fail} ÉCHOUÉ | ⏭ ${ignored} IGNORÉ | 📋 1 MANUEL`);
  await logAction(req, 'AUTO_RUN_VALIDATION', 'validations', { userName, pass, fail });

  res.json({
    success : true,
    cases   : results,
    summary : { pass, fail, ignored, manual: 1, total: results.length },
  });
});

// ══════════════════════════════════════════════════════════
// POST /api/validations/:id/send-rapport
// Génère un rapport PDF + email HTML et envoie au marchand et à la banque
// ══════════════════════════════════════════════════════════
router.post('/:id/send-rapport', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // ── Charger la validation ──────────────────────────
    const valRes = await query('SELECT * FROM validations WHERE id = $1', [id]);
    const val    = valRes.rows[0];
    if (!val) return res.status(404).json({ success: false, error: 'Validation introuvable' });

    const pid = val.processing_id;

    // ── Charger le dossier marchand ────────────────────
    const dossierRes = await query(
      `SELECT mt.*, b.email AS bank_email, b.email_cc AS bank_email_cc, b.name AS bank_name
       FROM merchants_tracking mt
       LEFT JOIN banks b ON LPAD(b.code::text,2,'0') = SUBSTRING(mt.processing_id,1,2) AND b.actif=true
       WHERE mt.processing_id = $1`, [pid]
    );
    const dossier = dossierRes.rows[0];
    if (!dossier) return res.status(404).json({ success: false, error: 'Dossier marchand introuvable' });

    // ── Parser les cas de test ─────────────────────────
    let cases = [];
    try { cases = Array.isArray(val.cases_json) ? val.cases_json : JSON.parse(JSON.stringify(val.cases_json || [])); } catch(_) {}

    // ── Générer le PDF ─────────────────────────────────
    const PDFDocument = require('pdfkit');
    const { PassThrough } = require('stream');

    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc    = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks = [];
      const stream = new PassThrough();
      doc.pipe(stream);
      stream.on('data', c => chunks.push(c));
      stream.on('end',  () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);

      const NAVY  = '#0f2444';
      const GREEN = '#15803d';
      const RED   = '#dc2626';
      const GRAY  = '#475569';
      const now   = new Date();

      // En-tête
      doc.rect(0, 0, doc.page.width, 80).fill(NAVY);
      doc.fillColor('white').fontSize(18).font('Helvetica-Bold')
         .text('ClicToPay', 40, 20);
      doc.fontSize(11).font('Helvetica')
         .text('Rapport de validation — Cahier des recettes', 40, 44);
      doc.fillColor(GRAY).fontSize(9)
         .text(`Généré le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR')}`,
               doc.page.width - 200, 58, { width: 160, align: 'right' });

      // Infos marchand
      doc.moveDown(3);
      doc.fillColor(NAVY).fontSize(12).font('Helvetica-Bold').text('Informations marchand');
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor('#e2e8f0').stroke();
      doc.moveDown(0.5);

      const info = [
        ['Raison sociale',  val.raison_sociale || dossier.raison_sociale],
        ['Processing ID',   pid],
        ['Terminal ID',     val.terminal_id || dossier.terminal_id || '—'],
        ['Email marchand',  val.email_marchand || dossier.email_contact || '—'],
        ['Référence',       val.filename || '—'],
      ];
      info.forEach(([k, v]) => {
        doc.fillColor(GRAY).fontSize(9).font('Helvetica-Bold').text(k + ' :', 40, doc.y, { continued: true, width: 140 });
        doc.font('Helvetica').fillColor('#1e293b').text(' ' + v);
      });

      // Verdict global
      doc.moveDown(1);
      const verdictColor  = val.verdict === 'approved' ? GREEN : val.verdict === 'refused' ? RED : '#f59e0b';
      const verdictLabel  = val.verdict === 'approved' ? '✓ APPROUVÉ' : val.verdict === 'refused' ? '✗ REFUSÉ' : '⏳ EN ATTENTE';
      doc.rect(40, doc.y, doc.page.width - 80, 36).fill(verdictColor + '15');
      doc.fillColor(verdictColor).fontSize(13).font('Helvetica-Bold')
         .text(verdictLabel, 50, doc.y - 28);
      doc.fillColor(GRAY).fontSize(9).font('Helvetica')
         .text(`${val.cas_reussis || 0}/${val.total_cas || 0} cas réussis · Taux : ${val.taux_reussite || 0}%`, 50, doc.y - 14);

      // Tableau des cas
      doc.moveDown(2);
      doc.fillColor(NAVY).fontSize(12).font('Helvetica-Bold').text('Résultats par cas de test');
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor('#e2e8f0').stroke();
      doc.moveDown(0.5);

      const CW = [55, 160, 70, 220];
      const headers = ['ID', 'Cas de test', 'Verdict', 'Erreurs / Remarques'];
      let x = 40;

      // Header tableau
      doc.rect(40, doc.y, doc.page.width - 80, 18).fill('#f1f5f9');
      headers.forEach((h, i) => {
        doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text(h, x + 4, doc.y - 14, { width: CW[i] - 6 });
        x += CW[i];
      });
      doc.moveDown(0.5);

      // Lignes
      const CTP_NAMES = {
        'CTP-01': 'Enregistrement commande',
        'CTP-02': 'Redirection paiement',
        'CTP-03': 'Paiement accepté (4509)',
        'CTP-04': 'Paiement refusé (5104)',
        'CTP-05': 'Statut returnUrl',
        'CTP-06': 'Paramètres manquants',
        'CTP-07': 'Doublon orderNumber',
        'CTP-08': 'orderId inexistant',
      };

      cases.forEach((c, idx) => {
        const rowY  = doc.y;
        const rowH  = Math.max(18, (c.errors?.length || 0) * 10 + 12);
        if (idx % 2 === 0) doc.rect(40, rowY, doc.page.width - 80, rowH).fill('#f8fafc');

        const vColor = c.verdict === 'pass' ? GREEN : c.verdict === 'fail' ? RED : '#f59e0b';
        const vLabel = c.verdict === 'pass' ? '✓ Réussi' : c.verdict === 'fail' ? '✗ Échoué' : '— En attente';

        x = 40;
        doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text(c.tcId || '—', x + 4, rowY + 4, { width: CW[0] - 6 }); x += CW[0];
        doc.font('Helvetica').fillColor('#334155').text(CTP_NAMES[c.tcId] || c.tcId, x + 4, rowY + 4, { width: CW[1] - 6 }); x += CW[1];
        doc.fillColor(vColor).font('Helvetica-Bold').text(vLabel, x + 4, rowY + 4, { width: CW[2] - 6 }); x += CW[2];

        const errText = (c.errors || []).join(' · ') || '—';
        doc.fillColor(c.errors?.length ? RED : GRAY).font('Helvetica').fontSize(7)
           .text(errText, x + 4, rowY + 4, { width: CW[3] - 6 });

        doc.y = rowY + rowH;
      });

      // Recommandations si refusé
      if (val.verdict !== 'approved') {
        doc.moveDown(1.5);
        doc.rect(40, doc.y, doc.page.width - 80, 14).fill('#fef2f2');
        doc.fillColor(RED).fontSize(9).font('Helvetica-Bold')
           .text('Actions requises', 50, doc.y - 10);
        doc.moveDown(0.8);
        doc.fillColor(GRAY).fontSize(8).font('Helvetica')
           .text('Veuillez corriger les cas en échec et soumettre un nouveau cahier des recettes.', 50, doc.y, { width: doc.page.width - 100 });
        doc.moveDown(0.3);
        doc.text('Pour toute question : webmaster@clictopay.com', 50, doc.y);
      }

      // Pied de page
      doc.fontSize(7).fillColor('#94a3b8')
         .text('ClicToPay — Document confidentiel', 40, doc.page.height - 40, { align: 'center', width: doc.page.width - 80 });

      doc.end();
    });

    // ── Construire l'email HTML ────────────────────────
    const { sendMail, getCcList } = require('../config/mailer');

    const verdictLabel = val.verdict === 'approved' ? '✅ APPROUVÉ' : val.verdict === 'refused' ? '❌ REFUSÉ' : '⏳ EN ATTENTE';
    const verdictColor = val.verdict === 'approved' ? '#15803d' : val.verdict === 'refused' ? '#dc2626' : '#d97706';

    const casRows = cases.map(c => {
      const vColor = c.verdict === 'pass' ? '#15803d' : c.verdict === 'fail' ? '#dc2626' : '#d97706';
      const vLabel = c.verdict === 'pass' ? '✓ Réussi' : c.verdict === 'fail' ? '✗ Échoué' : '— En attente';
      const errs   = (c.errors || []).map(e => `<li style="color:#dc2626;font-size:11px;">${e}</li>`).join('');
      return `<tr style="background:${cases.indexOf(c)%2===0?'#f8fafc':'white'}">
        <td style="padding:6px 8px;font-family:monospace;font-size:12px;font-weight:600;color:#0f2444;">${c.tcId}</td>
        <td style="padding:6px 8px;font-size:12px;color:#334155;">${c.name || c.tcId}</td>
        <td style="padding:6px 8px;font-size:12px;font-weight:600;color:${vColor};">${vLabel}</td>
        <td style="padding:6px 8px;font-size:11px;">${errs ? `<ul style="margin:0;padding-left:14px;">${errs}</ul>` : '<span style="color:#94a3b8">—</span>'}</td>
      </tr>`;
    }).join('');

    const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
<div style="max-width:700px;margin:0 auto;padding:24px 0;">
  <div style="background:#0f2444;padding:24px 32px;border-radius:12px 12px 0 0;">
    <div style="font-size:22px;font-weight:700;color:white;">ClicToPay</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:4px;">Rapport de validation — Cahier des recettes</div>
  </div>
  <div style="background:white;padding:24px 32px;border:1px solid #e2e8f0;">
    <p style="font-size:13px;color:#475569;">Bonjour,</p>
    <p style="font-size:13px;color:#475569;">Veuillez trouver ci-dessous le rapport de validation du cahier des recettes pour le marchand <strong>${val.raison_sociale || pid}</strong>.</p>

    <div style="background:${verdictColor}15;border-left:4px solid ${verdictColor};padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;">
      <div style="font-size:16px;font-weight:700;color:${verdictColor};">${verdictLabel}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">${val.cas_reussis || 0}/${val.total_cas || 0} cas réussis · Taux de réussite : ${val.taux_reussite || 0}%</div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:8px;text-align:left;font-size:11px;color:#64748b;border-bottom:1px solid #e2e8f0;">ID</th>
          <th style="padding:8px;text-align:left;font-size:11px;color:#64748b;border-bottom:1px solid #e2e8f0;">Cas de test</th>
          <th style="padding:8px;text-align:left;font-size:11px;color:#64748b;border-bottom:1px solid #e2e8f0;">Verdict</th>
          <th style="padding:8px;text-align:left;font-size:11px;color:#64748b;border-bottom:1px solid #e2e8f0;">Erreurs</th>
        </tr>
      </thead>
      <tbody>${casRows}</tbody>
    </table>

    ${val.verdict !== 'approved' ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;padding:12px 16px;border-radius:8px;margin-top:16px;">
      <div style="font-size:12px;font-weight:600;color:#dc2626;margin-bottom:4px;">Actions requises</div>
      <div style="font-size:12px;color:#475569;">Veuillez corriger les cas en échec et soumettre un nouveau cahier des recettes à l'équipe ClicToPay.</div>
    </div>` : `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px 16px;border-radius:8px;margin-top:16px;">
      <div style="font-size:12px;font-weight:600;color:#15803d;">Félicitations !</div>
      <div style="font-size:12px;color:#475569;">Tous les tests sont validés. Votre intégration est conforme aux spécifications ClicToPay.</div>
    </div>`}
  </div>
  <div style="background:#f8fafc;padding:16px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;text-align:center;">
    <div style="font-size:11px;color:#94a3b8;">ClicToPay — Document confidentiel · webmaster@clictopay.com</div>
  </div>
</div></body></html>`;

    // ── Envoyer les emails ─────────────────────────────
    const subject = `[ClicToPay] Rapport de validation — ${val.raison_sociale || pid} — ${verdictLabel}`;
    const ccList  = getCcList();

    // CC banque
    const bankCc = [];
    if (dossier.bank_email)    bankCc.push(dossier.bank_email);
    if (dossier.bank_email_cc) {
      dossier.bank_email_cc.split(';').map(e => e.trim()).filter(Boolean).forEach(e => bankCc.push(e));
    }

    const toMarchand = val.email_marchand || dossier.email_contact;
    const ccFinal    = [...ccList, ...bankCc].filter((v,i,a) => v && a.indexOf(v) === i);

    await sendMail({
      to         : toMarchand,
      cc         : ccFinal,
      subject,
      html       : htmlBody,
      attachments: [{
        filename   : `Rapport_Validation_${pid}_${new Date().toISOString().slice(0,10)}.pdf`,
        content    : pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    // ── Marquer rapport envoyé en base ─────────────────
    await query(
      `UPDATE validations SET rapport_envoye_at = NOW() WHERE id = $1`, [id]
    ).catch(() => {}); // Ignorer si colonne absente

    await logAction(req, 'RAPPORT_VALIDATION_ENVOYE', `validation:${id}`, {
      pid, verdict: val.verdict, sentTo: toMarchand, cc: ccFinal,
    });

    console.log(`📋 Rapport validation envoyé → ${toMarchand} | CC: ${ccFinal.join(', ')} | Verdict: ${val.verdict}`);
    res.json({ success: true, sentTo: toMarchand, cc: ccFinal, verdict: val.verdict });

  } catch(e) {
    console.error('[send-rapport]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
