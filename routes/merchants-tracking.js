// routes/merchants-tracking.js — Suivi dossiers marchands PostgreSQL
const express   = require('express');
const router    = express.Router();
const { query, pool } = require('../db/postgres');
const { requireAuth } = require('../middleware/auth');
const { bankFilter, enforceBankAccess } = require('../middleware/banquier');
const { logAction }   = require('../middleware/audit');

// ── GET /api/tracking/stats ───────────────────────────────
// DOIT être AVANT /:processing_id
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const [pipeline, recent] = await Promise.all([
      query(`SELECT statut, COUNT(*) AS n FROM merchants_tracking GROUP BY statut`, []),
      query(`SELECT processing_id, raison_sociale, statut, date_import
             FROM merchants_tracking ORDER BY date_import DESC LIMIT 10`, []),
    ]);
    const stats = {};
    pipeline.rows.forEach(r => { stats[r.statut] = parseInt(r.n); });
    res.json({ success: true, pipeline: stats, recent: recent.rows });
  } catch (err) {
    console.error('GET /tracking/stats:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/tracking/export ──────────────────────────────
router.get('/export', requireAuth, async (req, res) => {
  try {
    const result = await query(
      req.bankFilter?.isBanquier
        ? `SELECT mt.processing_id, mt.raison_sociale, mt.email_contact,
              mt.statut, mt.date_import, mt.date_prise_en_charge, mt.date_envoi_recettes,
              mt.date_reception_recettes, mt.date_validation, mt.date_notif_banque, mt.date_production,
              mt.tracking_ref_test, mt.tracking_ref_prod, mt.notes, mt.bank_name,
              mt.terminal_id, mt.mcc, mt.site_url,
              mt.uat_status, mt.uat_merchant_id, mt.uat_provisioned_at, mt.uat_error_message
           FROM merchants_tracking mt
           WHERE SUBSTRING(mt.processing_id, 1, 2) = $1
           ORDER BY mt.date_import DESC`
        : `SELECT processing_id, raison_sociale, email_contact,
              statut, date_import, date_prise_en_charge, date_envoi_recettes,
              date_reception_recettes, date_validation, date_notif_banque, date_production,
              tracking_ref_test, tracking_ref_prod, notes, bank_name,
              terminal_id, mcc, site_url,
              uat_status, uat_merchant_id, uat_provisioned_at, uat_error_message
           FROM merchants_tracking ORDER BY date_import DESC`,
      req.bankFilter?.isBanquier ? [req.bankFilter.code] : []
    );
    res.json({ success: true, data: result.rows });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/tracking/import ─────────────────────────────
router.post('/import', requireAuth, async (req, res) => {
  const { rows } = req.body;

  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ success: false, error: 'Aucune donnée à importer' });

  console.log(`[import] Debut : ${rows.length} lignes`);
  let inserted = 0, updated = 0, unchanged = 0, errors = 0;

  const diff = (dbVal, excelVal) => {
    if (!excelVal || excelVal === '') return false;
    return (excelVal.toString().trim()) !== ((dbVal || '').toString().trim());
  };

  // ── Étape 1 : extraire tous les PIDs valides ──────────────
  const pidMap = {};   // pid → données Excel normalisées
  for (const row of rows) {
    const pid = String(row._normId || row._rawId || '').trim();
    if (!pid || pid.length < 5) { errors++; continue; }
    let dateCreation = null;
    if (row._dateCreation) {
      try { dateCreation = new Date(row._dateCreation).toISOString(); } catch {}
    }
    pidMap[pid] = {
      pid,
      raisonSociale : String(row._raisonSociale || '').trim() || null,
      emailContact  : String(row._emailExcel || row['Email'] || row._email || row['Webmaster'] || '').trim() || null,
      webmaster     : String(row['Webmaster'] || row._webmaster || '').trim() || null,
      terminal      : String(row._terminal    || '').trim() || null,
      url           : (() => {
        const v = String(row._url || '').trim();
        return (v && !v.includes('@')) ? v : null;  // rejeter les emails
      })(),
      mcc           : String(row._mcc         || '').trim() || null,
      adresse       : String(row['Adresse']   || '').trim() || null,
      telephone     : String(row['Telephone'] || '').trim() || null,
      rne           : String(row['RNE']       || '').trim() || null,
      oracleProd    : row._status === 'prod' || row._status === 'both',
      oracleTest    : row._status === 'test' || row._status === 'both',
      dateCreation,
    };
  }

  const pids = Object.keys(pidMap);
  if (pids.length === 0)
    return res.json({ success: true, inserted: 0, updated: 0, unchanged: 0, errors, total: rows.length });

  // ── Étape 2 : UNE seule requête pour charger tous les existants ──
  const existingMap = {};
  try {
    const ph  = pids.map((_, i) => `$${i + 1}`).join(',');
    const res2= await query(`SELECT * FROM merchants_tracking WHERE processing_id IN (${ph})`, pids);
    res2.rows.forEach(r => { existingMap[r.processing_id] = r; });
  } catch(e) {
    console.error('[import] Erreur SELECT batch:', e.message);
  }

  // ── Étape 3 : Séparer nouveaux / existants ────────────────
  const toInsert = [];
  const toUpdate = [];

  for (const d of Object.values(pidMap)) {
    const ex = existingMap[d.pid];
    if (!ex) {
      // Nouveau
      const statut = d.oracleProd ? 'en_production'
                   : d.oracleTest ? 'recettes_envoyees'
                   : 'en_attente';
      toInsert.push({ ...d, statut });
    } else {
      // Existant — diff champ par champ
      const ch = {};
      if (diff(ex.raison_sociale,      d.raisonSociale))  ch.raison_sociale      = d.raisonSociale;
      if (diff(ex.email_contact,       d.emailContact))   ch.email_contact       = d.emailContact;
      if (diff(ex.webmaster,           d.webmaster))      ch.webmaster           = d.webmaster;
      if (diff(ex.terminal_id,         d.terminal))       ch.terminal_id         = d.terminal;
      if (diff(ex.mcc,                 d.mcc))            ch.mcc                 = d.mcc;
      if (diff(ex.site_url,            d.url))            ch.site_url            = d.url;
      if (diff(ex.adresse,             d.adresse))        ch.adresse             = d.adresse;
      if (diff(ex.telephone,           d.telephone))      ch.telephone           = d.telephone;
      if (diff(ex.rne,                 d.rne))            ch.rne                 = d.rne;
      if (d.dateCreation && !ex.date_creation_excel)      ch.date_creation_excel = d.dateCreation;
      if (d.oracleProd !== ex.oracle_prod)                ch.oracle_prod         = d.oracleProd;
      if (d.oracleTest !== ex.oracle_test)                ch.oracle_test         = d.oracleTest;
      // Règle Oracle PROD → en_production
      if (d.oracleProd && ex.statut !== 'en_production') {
        ch.statut          = 'en_production';
        ch._setDateProd    = true;  // flag pour date_production = NOW()
      } else if (d.oracleTest && !d.oracleProd && ex.statut === 'en_attente') {
        ch.statut = 'recettes_envoyees';
      }

      if (Object.keys(ch).length > 0) toUpdate.push({ pid: d.pid, ch });
      else unchanged++;
    }
  }

  // ── Étape 4 : Batch INSERT (groupes de 50) ────────────────
  const BATCH = 50;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH);
    const vals  = [];
    const ph    = chunk.map((d, j) => {
      const b = j * 15;
      vals.push(d.pid, d.raisonSociale, d.emailContact, d.webmaster,
                d.terminal, d.mcc, d.url, d.adresse, d.telephone, d.rne,
                d.oracleProd, d.oracleTest,
                d.dateCreation || new Date().toISOString(),
                d.dateCreation, d.statut);
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15})`;
    }).join(',');
    try {
      await query(`
        INSERT INTO merchants_tracking
          (processing_id,raison_sociale,email_contact,webmaster,terminal_id,
           mcc,site_url,adresse,telephone,rne,oracle_prod,oracle_test,
           date_import,date_creation_excel,statut)
        VALUES ${ph} ON CONFLICT (processing_id) DO NOTHING`, vals);
      inserted += chunk.length;
    } catch(e) {
      console.error('[import] Erreur batch INSERT:', e.message);
      errors += chunk.length;
    }
  }

  // ── Étape 5 : UPDATE individuels (seulement si changements) ──
  for (const item of toUpdate) {
    try {
      const setDateProd = item.ch._setDateProd;
      delete item.ch._setDateProd;

      const keys  = Object.keys(item.ch);
      const vals  = Object.values(item.ch);
      const setCl = keys.map((k, i) => `${k} = $${i + 2}`);
      if (setDateProd) setCl.push('date_production = COALESCE(date_production, NOW())');
      setCl.push('updated_at = NOW()');

      await query(
        `UPDATE merchants_tracking SET ${setCl.join(', ')} WHERE processing_id = $1`,
        [item.pid, ...vals]
      );
      updated++;
    } catch(e) {
      console.error(`[import] Erreur UPDATE ${item.pid}:`, e.message);
      errors++;
    }
  }

  console.log(`[import] Termine: ${inserted} inseres | ${updated} mis a jour | ${unchanged} inchanges | ${errors} erreurs`);
  await logAction(req, 'IMPORT_EXCEL', 'merchants_tracking', { inserted, updated, unchanged, errors });
  res.json({ success: true, inserted, updated, unchanged, errors, total: rows.length });
});

// ── GET /api/tracking — liste ─────────────────────────────
router.get('/', requireAuth, bankFilter, async (req, res) => {
  const { statut, search, banque, limit = 500, offset = 0 } = req.query;
  try {
    // ── RÈGLE GÉNÉRALE appliquée à chaque lecture ──────────
    // 1. Marchands avec oracle_prod=true mais statut != en_production → corriger
    await query(`
      UPDATE merchants_tracking
      SET statut = 'en_production',
          date_production = COALESCE(date_production, NOW())
      WHERE oracle_prod = true
        AND statut <> 'en_production'`
    ).catch(() => {});

    // 2. Marchands avec oracle_test=true, oracle_prod=false et en_attente → recettes_envoyees
    await query(`
      UPDATE merchants_tracking
      SET statut = 'recettes_envoyees'
      WHERE oracle_test = true
        AND oracle_prod = false
        AND statut = 'en_attente'`
    ).catch(() => {});

    // 3. Marchands en_production mais oracle_prod=false → vérifier incohérence
    // (peut arriver si marchand retiré d'Oracle PROD)
    // On ne rétrograde pas automatiquement — juste signaler via oracle_prod=false
    // ────────────────────────────────────────────────────────
    let whereClauses = [];
    const params     = [];

    if (statut && statut !== 'all') {
      params.push(statut);
      whereClauses.push(`mt.statut = $${params.length}`);
    }
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      whereClauses.push(`(mt.processing_id ILIKE $${params.length} OR mt.raison_sociale ILIKE $${params.length})`);
    }
    // Filtre banque admin (2 premiers chars du processing_id)
    if (banque?.trim()) {
      params.push(banque.trim().padStart(2, '0'));
      whereClauses.push(`SUBSTRING(mt.processing_id, 1, 2) = $${params.length}`);
    }
    // Filtre automatique banquier (étanchéité)
    if (req.bankFilter?.isBanquier) {
      params.push(req.bankFilter.code);
      whereClauses.push(`SUBSTRING(mt.processing_id, 1, 2) = $${params.length}`);
    }

    const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

    params.push(parseInt(limit), parseInt(offset));
    const limitOffset = `LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const sql = `
      SELECT mt.*,
             EXTRACT(DAY FROM (NOW() - mt.date_import))::INT AS jours_depuis_import
      FROM merchants_tracking mt
      ${where}
      ORDER BY mt.date_import DESC
      ${limitOffset}`;

    const [result, countResult] = await Promise.all([
      query(sql, params),
      query(`SELECT COUNT(*) FROM merchants_tracking mt ${where}`,
            params.slice(0, params.length - 2)),
    ]);

    res.json({
      success  : true,
      merchants: result.rows,
      total    : parseInt(countResult.rows[0].count),
    });
  } catch (err) {
    console.error('GET /tracking:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/tracking/:processing_id ─────────────────────
router.get('/:processing_id', requireAuth, async (req, res) => {
  try {
    const [dossier, validations, emails] = await Promise.all([
      query('SELECT * FROM merchants_tracking WHERE processing_id = $1', [req.params.processing_id]),
      query(`SELECT id, verdict, taux_reussite, cas_reussis, total_cas, filename, created_at
             FROM validations WHERE processing_id = $1 ORDER BY created_at DESC`, [req.params.processing_id]),
      query(`SELECT type, status, to_email, sent_at FROM emails_log
             WHERE processing_id = $1 ORDER BY sent_at DESC`, [req.params.processing_id]),
    ]);
    if (!dossier.rows[0]) return res.status(404).json({ success: false, error: 'Dossier introuvable' });
    res.json({ success: true, dossier: dossier.rows[0], validations: validations.rows, emails: emails.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/tracking ────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { processing_id, raison_sociale, email_contact } = req.body;
  if (!processing_id) return res.status(400).json({ success: false, error: 'processing_id requis' });
  try {
    const result = await query(`
      INSERT INTO merchants_tracking (processing_id, raison_sociale, email_contact)
      VALUES ($1, $2, $3)
      ON CONFLICT (processing_id) DO UPDATE SET
        raison_sociale = EXCLUDED.raison_sociale,
        email_contact  = EXCLUDED.email_contact
      RETURNING *`, [processing_id, raison_sociale, email_contact]);
    res.json({ success: true, dossier: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/tracking/:processing_id/statut ────────────
router.patch('/:processing_id/statut', requireAuth, async (req, res) => {
  const { statut, notes, tracking_ref } = req.body;
  const validStatuts = ['en_attente','prise_en_charge','recettes_envoyees',
    'recettes_recues','valide','banque_notifiee','en_production'];
  if (!validStatuts.includes(statut))
    return res.status(400).json({ success: false, error: `Statut invalide : ${statut}` });

  const dateFields = {
    prise_en_charge   : 'date_prise_en_charge',
    recettes_envoyees : 'date_envoi_recettes',
    recettes_recues   : 'date_reception_recettes',
    valide            : 'date_validation',
    banque_notifiee   : 'date_notif_banque',
    en_production     : 'date_production',
  };

  try {
    let sql = `UPDATE merchants_tracking SET statut = $1`;
    const params = [statut];
    if (dateFields[statut]) sql += `, ${dateFields[statut]} = NOW()`;
    if (statut === 'prise_en_charge') {
      params.push(req.user.id); sql += `, operateur_prise_en_charge = $${params.length}`;
      if (tracking_ref) { params.push(tracking_ref); sql += `, tracking_ref_test = $${params.length}`; }
    }
    if (statut === 'valide') {
      params.push(req.user.id); sql += `, operateur_validation = $${params.length}`;
    }
    if (statut === 'en_production' && tracking_ref) {
      params.push(tracking_ref); sql += `, tracking_ref_prod = $${params.length}`;
    }
    if (notes !== undefined) { params.push(notes); sql += `, notes = $${params.length}`; }
    params.push(req.params.processing_id);
    sql += ` WHERE processing_id = $${params.length} RETURNING *`;

    const result = await query(sql, params);
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Dossier introuvable' });
    const merchant = result.rows[0];

    // ── Envoi email + cahier recettes quand statut = recettes_envoyees ──
    if (statut === 'recettes_envoyees' && merchant.email_contact) {
      try {
        const {
          generateRef, generateTestCredentials, buildCahierRecettes, buildEmailHTML
        } = require('../config/email-prise-en-charge');
        const { sendMail, getCcList } = require('../config/mailer');

        const ref    = merchant.tracking_ref_test || generateRef(merchant.processing_id);
        const creds  = generateTestCredentials(merchant.processing_id, merchant.terminal_id);

        // Résoudre la banque du marchand
        let bankEmail = null, bankName = null;
        try {
          const pid = String(merchant.processing_id).replace(/\D/g,'');
          for (let len = 2; len >= 1; len--) {
            const code   = pid.substring(0, len).padStart(2,'0');
            const bRes   = await query('SELECT * FROM banks WHERE code=$1 AND actif=true',[code]).catch(()=>({rows:[]}));
            if (bRes.rows[0]) {
              bankEmail = bRes.rows[0].email;
              bankName  = bRes.rows[0].name;
              // Ajouter les emails CC supplémentaires de la banque
              if (bRes.rows[0].email_cc) {
                bRes.rows[0].email_cc.split(';').map(e=>e.trim()).filter(Boolean)
                  .forEach(e => { if (!ccBase.includes(e)) ccBase.push(e); });
              }
              break;
            }
          }
          if (bankEmail) console.log(`[tracking] Banque: ${bankName} → CC: ${bankEmail}`);
        } catch(e) { console.warn('[tracking] Banque:', e.message); }

        const ccBase  = getCcList();
        const ccFinal = bankEmail
          ? [...ccBase, bankEmail].filter((v,i,a) => v && a.indexOf(v)===i)
          : ccBase;

        const cahier = await buildCahierRecettes(merchant, ref, creds);
        const html   = buildEmailHTML(merchant, ref, creds);

        const mailOpts = {
          to     : merchant.email_contact,
          cc     : ccFinal,
          subject: `[ClicToPay · ${ref}] Bienvenue — Vos paramètres d'accès TEST · ${merchant.raison_sociale}`,
          html,
        };
        if (cahier) mailOpts.attachments = [{ filename:cahier.filename, content:cahier.content, contentType:cahier.contentType }];

        await sendMail(mailOpts);
        console.log(`📧 Recettes envoyées → ${merchant.email_contact} | CC: ${ccFinal.join(', ')}`);

        if (!merchant.tracking_ref_test)
          await query(`UPDATE merchants_tracking SET tracking_ref_test=$1 WHERE processing_id=$2`,[ref, merchant.processing_id]);
      } catch(mailErr) {
        console.error('❌ Erreur envoi email recettes:', mailErr.message);
      }
    }

    await logAction(req, `STATUT_${statut.toUpperCase()}`, `merchant:${req.params.processing_id}`);
    res.json({ success: true, statut: merchant.statut, processing_id: merchant.processing_id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/tracking/:processing_id/notes ─────────────
router.patch('/:processing_id/notes', requireAuth, async (req, res) => {
  try {
    await query('UPDATE merchants_tracking SET notes = $1 WHERE processing_id = $2',
      [req.body.notes, req.params.processing_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── DELETE /api/tracking/:processing_id ──────────────────
// Suppression d'un marchand de la base locale uniquement
router.delete('/:processing_id', requireAuth, async (req, res) => {
  const pid = req.params.processing_id;
  try {
    const result = await query(
      `DELETE FROM merchants_tracking WHERE processing_id = $1 RETURNING processing_id, raison_sociale`,
      [pid]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: `Marchand ${pid} introuvable` });
    }
    await logAction(req, 'DELETE_MERCHANT', `merchant:${pid}`, {
      raison_sociale: result.rows[0].raison_sociale,
    });
    console.log(`🗑  Marchand supprimé : ${pid} — ${result.rows[0].raison_sociale} (par ${req.user?.email || req.user?.id})`);
    res.json({ success: true, deleted: pid, raison_sociale: result.rows[0].raison_sociale });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/tracking/sync-oracle ───────────────────────
// Synchronise oracle_prod/oracle_test depuis les bases Oracle
// en comparant les processing_id locaux avec Oracle PROD et TEST
router.post('/sync-oracle', requireAuth, async (req, res) => {
  try {
    const { merchantsProdPool, merchantsTestPool } = req.app.locals || {};
    const prodPool = req.merchantsProdPool;
    const testPool = req.merchantsTestPool;

    // Charger tous les marchands locaux
    const local = await query(`SELECT processing_id, oracle_prod, oracle_test, statut FROM merchants_tracking`);
    const localList = local.rows;

    let updatedProd = 0, updatedTest = 0, updatedAbsent = 0;

    // Charger Oracle PROD si disponible
    let prodIds = new Set();
    if (prodPool) {
      try {
        const conn = await prodPool.getConnection();
        const r = await conn.execute(`SELECT PROCESSING_ID FROM EPG.MERCHANTLOGIN WHERE ROWNUM <= 50000`);
        conn.close();
        r.rows.forEach(row => {
          const pid = String(row[0] || '').trim().replace(/^0+/, '').padStart(9, '0');
          prodIds.add(pid);
          prodIds.add(String(row[0] || '').trim()); // aussi sans normalisation
        });
      } catch(e) { console.warn('[sync-oracle] Oracle PROD:', e.message); }
    }

    // Charger Oracle TEST si disponible
    let testIds = new Set();
    if (testPool) {
      try {
        const conn = await testPool.getConnection();
        const r = await conn.execute(`SELECT PROCESSING_ID FROM EPG.MERCHANTLOGIN WHERE ROWNUM <= 50000`);
        conn.close();
        r.rows.forEach(row => {
          const pid = String(row[0] || '').trim().replace(/^0+/, '').padStart(9, '0');
          testIds.add(pid);
          testIds.add(String(row[0] || '').trim());
        });
      } catch(e) { console.warn('[sync-oracle] Oracle TEST:', e.message); }
    }

    // Mettre à jour chaque marchand
    for (const m of localList) {
      const pid      = m.processing_id;
      const inProd   = prodIds.has(pid);
      const inTest   = testIds.has(pid);
      const newStatut = inProd ? 'en_production'
                      : inTest ? 'recettes_envoyees'
                      : m.statut;

      if (inProd !== m.oracle_prod || inTest !== m.oracle_test || newStatut !== m.statut) {
        await query(`
          UPDATE merchants_tracking
          SET oracle_prod = $2, oracle_test = $3, statut = $4,
              date_production = CASE WHEN $2 = true AND date_production IS NULL THEN NOW() ELSE date_production END,
              updated_at = NOW()
          WHERE processing_id = $1`,
          [pid, inProd, inTest, newStatut]
        );
        if (inProd) updatedProd++;
        else if (inTest) updatedTest++;
        else if (!inProd && m.oracle_prod) updatedAbsent++;
      }
    }

    await logAction(req, 'SYNC_ORACLE', 'merchants_tracking', { updatedProd, updatedTest, updatedAbsent });
    res.json({ success: true, updatedProd, updatedTest, updatedAbsent, total: localList.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PATCH /api/tracking/:processing_id/payfac ────────────
// Mettre à jour le PAYFAC associé à un marchand
router.patch('/:processing_id/payfac', requireAuth, async (req, res) => {
  const { payfac_id, payfac_nom } = req.body;
  const pid = req.params.processing_id;
  try {
    await query(`
      UPDATE merchants_tracking
      SET payfac_id  = $2,
          payfac_nom = $3,
          updated_at = NOW()
      WHERE processing_id = $1`,
      [pid, payfac_id || null, payfac_nom || null]
    );
    await logAction(req, 'UPDATE_PAYFAC', `merchant:${pid}`, { payfac_id, payfac_nom });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
