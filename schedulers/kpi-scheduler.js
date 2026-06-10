// schedulers/kpi-scheduler.js
// Collecte mensuelle automatique des KPI stratégiques 2027-2030
// Déclenchement : le 1er de chaque mois à 06h00, + vérification quotidienne
'use strict';

const { query }  = require('../db/postgres');
const oracledb   = require('oracledb');

// ── Calcul du statut selon seuils ────────────────────────────
function calcStatut(valeur, kpi) {
  if (valeur === null || valeur === undefined) return 'na';
  const v  = parseFloat(valeur);
  const so = parseFloat(kpi.seuil_orange);
  const sr = parseFloat(kpi.seuil_rouge);
  if (isNaN(so) || isNaN(sr)) return 'vert';
  if (kpi.sens_amelioration === 'haut') {
    if (v <= sr) return 'rouge';
    if (v <= so) return 'orange';
  } else {
    if (v >= sr) return 'rouge';
    if (v >= so) return 'orange';
  }
  return 'vert';
}

// ── Adaptateur CTP (Oracle BPC) ──────────────────────────────
async function adapterCtp(code, dateD, dateF, oPool) {
  if (!oPool) return null;
  const oConn = await oPool.getConnection();
  try {
    if (code === 'AXE3_TX_SUCCES_CTP') {
      const r = await oConn.execute(`
        SELECT COUNT(*) AS TOTAL,
          SUM(CASE WHEN TRIM(PAYMENT_STATE)='payment_deposited' THEN 1 ELSE 0 END) AS OK,
          SUM(CASE WHEN ACTION_CODE_INT IN (100827,-2007) THEN 1 ELSE 0 END) AS TIMEOUT
        FROM BPCTRANSACTIONS
        WHERE PROCESSING_ID='0383026168'
          AND TRUNC(TRANS_DATE) >= TO_DATE(:dd,'YYYY-MM-DD')
          AND TRUNC(TRANS_DATE) <= TO_DATE(:df,'YYYY-MM-DD')`,
        { dd: dateD, df: dateF },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const row   = r.rows[0];
      const total = Number(row.TOTAL || 0);
      const ok    = Number(row.OK    || 0);
      const to    = Number(row.TIMEOUT || 0);
      const adj   = total - to;
      return adj > 0 ? Math.round(ok / adj * 1000) / 10 : null;
    }
    if (code === 'AXE3_NB_MARCHANDS_ACTIFS') {
      const r = await oConn.execute(`
        SELECT COUNT(DISTINCT PROCESSING_ID) AS NB FROM BPCTRANSACTIONS
        WHERE TRUNC(TRANS_DATE) >= TO_DATE(:dd,'YYYY-MM-DD')
          AND TRUNC(TRANS_DATE) <= TO_DATE(:df,'YYYY-MM-DD')`,
        { dd: dateD, df: dateF },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return Number(r.rows[0]?.NB || 0);
    }
    if (code === 'AXE3_VOL_CTP') {
      const r = await oConn.execute(`
        SELECT SUM(AMOUNT)/100 AS VOL FROM BPCTRANSACTIONS
        WHERE TRIM(PAYMENT_STATE)='payment_deposited'
          AND TRUNC(TRANS_DATE) >= TO_DATE(:dd,'YYYY-MM-DD')
          AND TRUNC(TRANS_DATE) <= TO_DATE(:df,'YYYY-MM-DD')`,
        { dd: dateD, df: dateF },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return Number(r.rows[0]?.VOL || 0);
    }
  } finally {
    await oConn.close();
  }
  return null;
}

// ── Adaptateur Paysmart (SQL Server) ─────────────────────────
async function adapterPaysmart(code, moisPad, annee, sqlPool) {
  if (!sqlPool) return null;
  const pat = `'__/${moisPad}/${annee}%'`;
  if (code === 'AXE6_TX_SUCCES_PSM') {
    const r = await sqlPool.request().query(`
      SELECT COUNT(*) AS TOTAL,
        SUM(CASE WHEN [Etat]='PAID' THEN 1 ELSE 0 END) AS PAID
      FROM [switchdb].[dbo].[TO_QLIK_BI_new]
      WHERE [Date] LIKE ${pat}`);
    const total = Number(r.recordset[0]?.TOTAL || 0);
    const paid  = Number(r.recordset[0]?.PAID  || 0);
    return total > 0 ? Math.round(paid / total * 1000) / 10 : null;
  }
  if (code === 'AXE6_NB_FACTURIERS') {
    const r = await sqlPool.request().query(`
      SELECT COUNT(DISTINCT [Facturier]) AS NB
      FROM [switchdb].[dbo].[TO_QLIK_BI_new]
      WHERE [Etat]='PAID' AND [Date] LIKE ${pat}`);
    return Number(r.recordset[0]?.NB || 0);
  }
  if (code === 'AXE6_VOL_PSM') {
    const r = await sqlPool.request().query(`
      SELECT SUM(CAST([Montant] AS FLOAT))/1000 AS VOL
      FROM [switchdb].[dbo].[TO_QLIK_BI_new]
      WHERE [Etat]='PAID' AND [Date] LIKE ${pat}`);
    return Number(r.recordset[0]?.VOL || 0);
  }
  return null;
}

// ── Adaptateur API tokens ─────────────────────────────────────
async function adapterApi(code) {
  if (code === 'AXE5_NB_PARTENAIRES') {
    const r = await query(
      `SELECT COUNT(DISTINCT user_id) AS nb FROM api_tokens
       WHERE actif=true AND expires_at > NOW()`, []
    );
    return Number(r.rows[0]?.nb || 0);
  }
  return null;
}

// ── Adaptateur SLA BPC ────────────────────────────────────────
async function adapterSla(code, dateD, dateF) {
  if (code === 'AXE8_SLA_BPC') {
    const r = await query(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN statut='closed_on_time' THEN 1 ELSE 0 END) AS ok
      FROM sla_tickets WHERE created_at >= $1 AND created_at <= $2`,
      [dateD, dateF]
    );
    const total = Number(r.rows[0]?.total || 0);
    const ok    = Number(r.rows[0]?.ok    || 0);
    return total > 0 ? Math.round(ok / total * 1000) / 10 : null;
  }
  return null;
}

// ── Enregistrer alerte si nécessaire ─────────────────────────
async function declencherAlerte(kpiId, periode, niveau, valeur, seuil) {
  try {
    const prev = await query(`
      SELECT COUNT(*) AS nb FROM kpi_alerte
      WHERE kpi_id=$1 AND niveau=$2 AND acquittee=false
        AND created_at >= NOW() - INTERVAL '3 months'`,
      [kpiId, niveau]
    );
    const moisConsec = parseInt(prev.rows[0]?.nb || 0) + 1;
    await query(
      `INSERT INTO kpi_alerte
       (kpi_id, periode, niveau, valeur, seuil, mois_consecutifs)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [kpiId, periode, niveau, valeur, seuil, moisConsec]
    );
    // Alerte "plan de rattrapage" si 2+ mois consécutifs
    if (moisConsec >= 2) {
      await query(
        `INSERT INTO alert_rules_triggered
         (kpi_id, periode, message, niveau)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [kpiId, periode,
         `KPI ${niveau} depuis ${moisConsec} mois — plan de rattrapage requis`,
         niveau]
      ).catch(() => {}); // table optionnelle
    }
  } catch(e) {
    console.warn('[kpi-scheduler] alerte:', e.message);
  }
}

// ── Collecte principale pour une période donnée ───────────────
async function runKpiCollection(periode, pools) {
  const { oraclePool, sqlPool } = pools;
  const [annee, mois] = periode.split('-');
  const moisPad = mois.padStart(2,'0');
  const dateD   = `${annee}-${moisPad}-01`;
  const lastDay = new Date(parseInt(annee), parseInt(mois), 0).getDate();
  const dateF   = `${annee}-${moisPad}-${lastDay}`;

  console.log(`[kpi-scheduler] Collecte ${periode} (${dateD} → ${dateF})`);

  // Récupérer tous les KPI automatiques actifs
  const kpisRes = await query(
    `SELECT * FROM kpi_def WHERE source='auto' AND actif=true ORDER BY axe, code`, []
  );

  const results = { ok:0, skipped:0, errors:0 };

  for (const kpi of kpisRes.rows) {
    try {
      let valeur = null;

      switch (kpi.adapter) {
        case 'ctp':
          valeur = await adapterCtp(kpi.code, dateD, dateF, oraclePool);
          break;
        case 'paysmart':
          valeur = await adapterPaysmart(kpi.code, moisPad, annee, sqlPool);
          break;
        case 'api':
          valeur = await adapterApi(kpi.code);
          break;
        case 'sla':
          valeur = await adapterSla(kpi.code, dateD, dateF);
          break;
        case 'switch':
          // TODO: requêtes SmartVista switch à définir
          valeur = null;
          break;
        default:
          valeur = null;
      }

      if (valeur !== null) {
        const statut = calcStatut(valeur, kpi);
        await query(
          `INSERT INTO kpi_value (kpi_id, periode, valeur, statut, source_calcul)
           VALUES ($1, $2, $3, $4, 'auto')
           ON CONFLICT (kpi_id, periode)
           DO UPDATE SET valeur=$3, statut=$4, source_calcul='auto', updated_at=NOW()`,
          [kpi.id, dateD, valeur, statut]
        );
        if (statut === 'orange' || statut === 'rouge') {
          const seuil = statut === 'rouge' ? kpi.seuil_rouge : kpi.seuil_orange;
          await declencherAlerte(kpi.id, dateD, statut, valeur, seuil);
        }
        console.log(`[kpi-scheduler] ✅ ${kpi.code}: ${valeur} (${statut})`);
        results.ok++;
      } else {
        console.log(`[kpi-scheduler] ⏭  ${kpi.code}: pas de données (${kpi.adapter || 'no-adapter'})`);
        results.skipped++;
      }
    } catch(e) {
      console.error(`[kpi-scheduler] ❌ ${kpi.code}:`, e.message);
      results.errors++;
    }
  }

  console.log(`[kpi-scheduler] Collecte ${periode} terminée — ✅ ${results.ok} | ⏭ ${results.skipped} | ❌ ${results.errors}`);
  return results;
}

// ── Démarrage du scheduler ────────────────────────────────────
function startKpiScheduler(pools) {
  // Vérification toutes les heures : faut-il lancer la collecte du mois ?
  const CHECK_INTERVAL = 60 * 60 * 1000; // 1h

  async function checkAndCollect() {
    try {
      const now = new Date();
      // Déclencher le 1er du mois entre 6h00 et 7h00
      if (now.getDate() !== 1) return;
      if (now.getHours() < 6 || now.getHours() >= 7) return;

      // Période = mois précédent (collecte du mois clôturé)
      const moisPrec = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const annee    = moisPrec.getFullYear();
      const mois     = String(moisPrec.getMonth() + 1).padStart(2,'0');
      const periode  = `${annee}-${mois}-01`;

      // Vérifier si déjà collecté ce mois
      const dejaFait = await query(
        `SELECT COUNT(*) AS nb FROM kpi_value
         WHERE periode = $1 AND source_calcul = 'auto'`, [periode]
      );
      if (parseInt(dejaFait.rows[0]?.nb || 0) > 0) {
        console.log(`[kpi-scheduler] ${periode} déjà collecté — skip`);
        return;
      }

      await runKpiCollection(periode, pools);

    } catch(e) {
      console.error('[kpi-scheduler] Erreur:', e.message);
    }
  }

  // Première vérification après 30s (laisser le temps aux pools de s'initialiser)
  setTimeout(checkAndCollect, 30 * 1000);
  setInterval(checkAndCollect, CHECK_INTERVAL);

  console.log('[kpi-scheduler] ✅ Démarré — vérification toutes les heures, collecte le 1er du mois à 06h');
}

module.exports = { startKpiScheduler, runKpiCollection };
