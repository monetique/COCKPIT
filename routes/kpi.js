// routes/kpi.js — API KPI Stratégie 2027-2030
'use strict';
const express   = require('express');
const router    = express.Router();
const { query } = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

// ── Helpers ──────────────────────────────────────────────────
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

// ── GET /api/kpi/def — référentiel KPI ───────────────────────
router.get('/def', requireAuth, async (req, res) => {
  const { axe, source, actif = 'true' } = req.query;
  try {
    let where = 'WHERE 1=1';
    const params = [];
    if (actif !== 'all') { params.push(actif === 'true'); where += ` AND actif=$${params.length}`; }
    if (axe)    { params.push(parseInt(axe)); where += ` AND axe=$${params.length}`; }
    if (source) { params.push(source);        where += ` AND source=$${params.length}`; }

    const r = await query(
      `SELECT * FROM kpi_def ${where} ORDER BY axe, code`, params
    );
    res.json({ success:true, kpis: r.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/kpi/def/:id — détail d'un KPI ───────────────────
router.get('/def/:id', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM kpi_def WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success:false });
    res.json({ success:true, kpi: r.rows[0] });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── PATCH /api/kpi/def/:id — modifier cibles/seuils ──────────
router.patch('/def/:id', requireAuth, requireRole('admin','pilotage'), async (req, res) => {
  const allowed = ['label','description','baseline','cible_2027','cible_2028',
                   'cible_2029','cible_2030','seuil_orange','seuil_rouge','actif'];
  const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ success:false, error:'Aucun champ valide' });
  try {
    const sets   = fields.map((f,i) => `${f}=$${i+2}`).join(', ');
    const values = fields.map(f => req.body[f]);
    await query(`UPDATE kpi_def SET ${sets}, updated_at=NOW() WHERE id=$1`,
                [req.params.id, ...values]);
    await logAction(req, 'KPI_DEF_UPDATE', `kpi:${req.params.id}`, req.body);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/kpi/values — valeurs par période ─────────────────
router.get('/values', requireAuth, async (req, res) => {
  const { axe, kpi_id, depuis, jusqu_a, limit = 24 } = req.query;
  try {
    let where = 'WHERE 1=1';
    const params = [];
    if (kpi_id) { params.push(kpi_id); where += ` AND v.kpi_id=$${params.length}`; }
    if (axe)    { params.push(parseInt(axe)); where += ` AND d.axe=$${params.length}`; }
    if (depuis) { params.push(depuis);  where += ` AND v.periode>=$${params.length}`; }
    if (jusqu_a){ params.push(jusqu_a); where += ` AND v.periode<=$${params.length}`; }

    params.push(parseInt(limit));
    const r = await query(`
      SELECT v.*, d.code, d.label, d.unite, d.axe, d.sens_amelioration,
             d.seuil_orange, d.seuil_rouge, d.cible_2027, d.cible_2028,
             d.cible_2029, d.cible_2030
      FROM kpi_value v
      JOIN kpi_def d ON d.id = v.kpi_id
      ${where}
      ORDER BY v.periode DESC, d.axe, d.code
      LIMIT $${params.length}`, params
    );
    res.json({ success:true, values: r.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/kpi/dashboard — vue synthèse par axe ────────────
router.get('/dashboard', requireAuth, async (req, res) => {
  const { periode } = req.query;
  // Période = dernier mois disponible si non précisée
  try {
    const periodeClause = periode
      ? `AND v.periode = '${periode}'`
      : `AND v.periode = (SELECT MAX(periode) FROM kpi_value)`;

    const r = await query(`
      SELECT
        d.axe,
        d.id AS kpi_id, d.code, d.label, d.unite,
        d.baseline, d.cible_2027, d.cible_2030,
        d.seuil_orange, d.seuil_rouge, d.sens_amelioration,
        v.valeur, v.statut, v.periode, v.source_calcul,
        -- Valeur précédente pour tendance
        LAG(v.valeur) OVER (PARTITION BY d.id ORDER BY v.periode) AS valeur_precedente
      FROM kpi_def d
      LEFT JOIN kpi_value v ON v.kpi_id = d.id ${periodeClause}
      WHERE d.actif = true
      ORDER BY d.axe, d.code`, []
    );

    // Grouper par axe
    const axes = {};
    const AXE_LABELS = {
      1:'Switch national', 2:'TUNPAY', 3:'ClicToPay',
      4:'Data & Fraude', 5:'Open Banking', 6:'Paysmart',
      7:'Programmes de place', 8:'Transverse'
    };
    r.rows.forEach(row => {
      if (!axes[row.axe]) axes[row.axe] = {
        axe: row.axe, label: AXE_LABELS[row.axe] || `Axe ${row.axe}`,
        kpis: [], statut_global: 'vert'
      };
      axes[row.axe].kpis.push(row);
      // Statut global de l'axe = le pire statut de ses KPI
      const ordre = { rouge:3, orange:2, vert:1, na:0 };
      if ((ordre[row.statut] || 0) > (ordre[axes[row.axe].statut_global] || 0)) {
        axes[row.axe].statut_global = row.statut || 'na';
      }
    });

    res.json({ success:true, axes: Object.values(axes).sort((a,b) => a.axe-b.axe) });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── POST /api/kpi/values — saisir une valeur (auto ou manuel) ─
router.post('/values', requireAuth, requireRole('admin','pilotage','chef_division'), async (req, res) => {
  const { kpi_id, periode, valeur, note, source_calcul = 'manuel' } = req.body;
  if (!kpi_id || !periode || valeur === undefined)
    return res.status(400).json({ success:false, error:'kpi_id, periode, valeur requis' });

  try {
    // Récupérer le KPI pour calculer le statut
    const kpiRes = await query('SELECT * FROM kpi_def WHERE id=$1', [kpi_id]);
    if (!kpiRes.rows.length) return res.status(404).json({ success:false, error:'KPI introuvable' });
    const kpi    = kpiRes.rows[0];
    const statut = calcStatut(valeur, kpi);

    // Si source manuelle → passer par la file de validation sauf admin
    if (source_calcul === 'manuel' && req.user.role !== 'admin') {
      const r = await query(
        `INSERT INTO kpi_manual_entry
         (kpi_id, periode, valeur_proposee, note, soumis_par)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [kpi_id, periode, valeur, note||null, req.user.id]
      );
      return res.json({ success:true, mode:'validation_requise', entryId: r.rows[0].id });
    }

    // Admin ou source auto → insertion directe
    const r = await query(
      `INSERT INTO kpi_value (kpi_id, periode, valeur, statut, source_calcul, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (kpi_id, periode)
       DO UPDATE SET valeur=$3, statut=$4, source_calcul=$5, note=$6, updated_at=NOW()
       RETURNING *`,
      [kpi_id, periode, valeur, statut, source_calcul, note||null]
    );

    // Vérifier si alerte à déclencher
    if (statut === 'orange' || statut === 'rouge') {
      await declencherAlerte(kpi_id, periode, statut, valeur,
        statut === 'rouge' ? kpi.seuil_rouge : kpi.seuil_orange);
    }

    await logAction(req, 'KPI_VALUE_SET', `kpi:${kpi.code}`, { periode, valeur, statut });
    res.json({ success:true, value: r.rows[0] });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── POST /api/kpi/manual/:id/valider ─────────────────────────
router.post('/manual/:id/valider', requireAuth, requireRole('admin','directeur','pilotage'), async (req, res) => {
  const { decision, raison_rejet } = req.body; // decision = 'valide' | 'rejete'
  try {
    const e = await query('SELECT * FROM kpi_manual_entry WHERE id=$1', [req.params.id]);
    if (!e.rows.length) return res.status(404).json({ success:false });
    const entry = e.rows[0];
    if (entry.statut_validation !== 'en_attente')
      return res.status(409).json({ success:false, error:'Déjà traitée' });

    await query(
      `UPDATE kpi_manual_entry SET statut_validation=$1, valide_par=$2,
       valide_at=NOW(), raison_rejet=$3 WHERE id=$4`,
      [decision, req.user.id, raison_rejet||null, req.params.id]
    );

    if (decision === 'valide') {
      // Insérer la valeur validée
      const kpiRes = await query('SELECT * FROM kpi_def WHERE id=$1', [entry.kpi_id]);
      const kpi    = kpiRes.rows[0];
      const statut = calcStatut(entry.valeur_proposee, kpi);
      await query(
        `INSERT INTO kpi_value (kpi_id, periode, valeur, statut, source_calcul, note)
         VALUES ($1,$2,$3,$4,'manuel',$5)
         ON CONFLICT (kpi_id, periode)
         DO UPDATE SET valeur=$3, statut=$4, source_calcul='manuel', updated_at=NOW()`,
        [entry.kpi_id, entry.periode, entry.valeur_proposee, statut, entry.note]
      );
    }

    await logAction(req, `KPI_MANUAL_${decision.toUpperCase()}`, `kpi_entry:${req.params.id}`, {});
    res.json({ success:true, decision });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/kpi/manual — file d'attente ─────────────────────
router.get('/manual', requireAuth, requireRole('admin','directeur','pilotage'), async (req, res) => {
  const { statut = 'en_attente' } = req.query;
  try {
    const r = await query(`
      SELECT e.*, d.code, d.label, d.unite, d.axe,
             u.nom AS soumis_nom, u.prenom AS soumis_prenom
      FROM kpi_manual_entry e
      JOIN kpi_def d ON d.id = e.kpi_id
      LEFT JOIN users u ON u.id = e.soumis_par
      WHERE e.statut_validation=$1
      ORDER BY e.soumis_at DESC`, [statut]
    );
    res.json({ success:true, entries: r.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/kpi/alertes — alertes actives ───────────────────
router.get('/alertes', requireAuth, async (req, res) => {
  try {
    const r = await query(`
      SELECT a.*, d.code, d.label, d.axe, d.unite
      FROM kpi_alerte a JOIN kpi_def d ON d.id = a.kpi_id
      WHERE a.acquittee = false
      ORDER BY a.niveau DESC, a.created_at DESC`, []
    );
    res.json({ success:true, alertes: r.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── POST /api/kpi/alertes/:id/acquitter ──────────────────────
router.post('/alertes/:id/acquitter', requireAuth, requireRole('admin','directeur','pilotage'), async (req, res) => {
  try {
    await query(
      `UPDATE kpi_alerte SET acquittee=true, acquittee_par=$1, acquittee_at=NOW() WHERE id=$2`,
      [req.user.id, req.params.id]
    );
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── POST /api/kpi/collect — collecte manuelle (admin) ────────
router.post('/collect', requireAuth, requireRole('admin','pilotage'), async (req, res) => {
  const { periode, axes } = req.body;
  if (!periode) return res.status(400).json({ success:false, error:'periode requis (YYYY-MM-01)' });
  try {
    const results = await collectKpis(periode, axes, req);
    res.json({ success:true, results });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── Fonction collecte via adaptateurs ────────────────────────
async function collectKpis(periode, axes, req) {
  const kpisRes = await query(
    `SELECT * FROM kpi_def WHERE source='auto' AND actif=true
     ${axes ? `AND axe = ANY($1)` : ''}
     ORDER BY axe`,
    axes ? [axes] : []
  );

  const results = [];
  for (const kpi of kpisRes.rows) {
    try {
      let valeur = null;
      const adapter = kpi.adapter;

      // ── Adaptateurs par source ──────────────────────────
      if (adapter === 'switch') {
        valeur = await adapterSwitch(kpi.code, periode, req);
      } else if (adapter === 'ctp') {
        valeur = await adapterCtp(kpi.code, periode, req);
      } else if (adapter === 'paysmart') {
        valeur = await adapterPaysmart(kpi.code, periode, req);
      } else if (adapter === 'api') {
        valeur = await adapterApi(kpi.code, periode, req);
      } else if (adapter === 'sla') {
        valeur = await adapterSla(kpi.code, periode, req);
      }

      if (valeur !== null) {
        const statut = calcStatut(valeur, kpi);
        await query(
          `INSERT INTO kpi_value (kpi_id, periode, valeur, statut, source_calcul)
           VALUES ($1,$2,$3,$4,'auto')
           ON CONFLICT (kpi_id, periode)
           DO UPDATE SET valeur=$3, statut=$4, source_calcul='auto', updated_at=NOW()`,
          [kpi.id, periode, valeur, statut]
        );
        if (statut === 'orange' || statut === 'rouge') {
          await declencherAlerte(kpi.id, periode, statut, valeur,
            statut === 'rouge' ? kpi.seuil_rouge : kpi.seuil_orange);
        }
        results.push({ code: kpi.code, valeur, statut, ok: true });
      } else {
        results.push({ code: kpi.code, valeur: null, statut: 'na', ok: false, raison: 'adapter_no_data' });
      }
    } catch(e) {
      results.push({ code: kpi.code, ok: false, raison: e.message });
    }
  }
  return results;
}

// ── Adaptateur Switch (Oracle BPC — TODO: requête réelle) ─────
async function adapterSwitch(code, periode, req) {
  // TODO: connecter Oracle BPC switch pour uptime, tps, taux_succes
  // Placeholder — retourne null jusqu'à connexion switch disponible
  return null;
}

// ── Adaptateur ClicToPay (Oracle BPC BPCTRANSACTIONS) ────────
async function adapterCtp(code, periode, req) {
  const oPool = req.oraclePool;
  if (!oPool) return null;
  const [annee, mois] = periode.split('-');
  const dateD = `${annee}-${mois}-01`;
  const lastDay = new Date(parseInt(annee), parseInt(mois), 0).getDate();
  const dateF   = `${annee}-${mois}-${String(lastDay).padStart(2,'0')}`;
  const oracledb = require('oracledb');
  const oConn = await oPool.getConnection();

  try {
    if (code === 'AXE3_TX_SUCCES_CTP') {
      const r = await oConn.execute(`
        SELECT
          COUNT(*) AS TOTAL,
          SUM(CASE WHEN TRIM(PAYMENT_STATE)='payment_deposited' THEN 1 ELSE 0 END) AS OK,
          SUM(CASE WHEN ACTION_CODE_INT IN (100827,-2007) THEN 1 ELSE 0 END) AS TIMEOUT
        FROM BPCTRANSACTIONS
        WHERE PROCESSING_ID='0383026168'
          AND TRUNC(TRANS_DATE) >= TO_DATE(:dd,'YYYY-MM-DD')
          AND TRUNC(TRANS_DATE) <= TO_DATE(:df,'YYYY-MM-DD')`,
        { dd: dateD, df: dateF },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const row = r.rows[0];
      const total   = Number(row.TOTAL || 0);
      const ok      = Number(row.OK || 0);
      const timeout = Number(row.TIMEOUT || 0);
      const ajuste  = total - timeout;
      return ajuste > 0 ? Math.round(ok / ajuste * 1000) / 10 : null;
    }
    if (code === 'AXE3_NB_MARCHANDS_ACTIFS') {
      const r = await oConn.execute(`
        SELECT COUNT(DISTINCT PROCESSING_ID) AS NB
        FROM BPCTRANSACTIONS
        WHERE TRUNC(TRANS_DATE) >= TO_DATE(:dd,'YYYY-MM-DD')
          AND TRUNC(TRANS_DATE) <= TO_DATE(:df,'YYYY-MM-DD')`,
        { dd: dateD, df: dateF },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return Number(r.rows[0]?.NB || 0);
    }
    if (code === 'AXE3_VOL_CTP') {
      const r = await oConn.execute(`
        SELECT SUM(AMOUNT)/100 AS VOL
        FROM BPCTRANSACTIONS
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
async function adapterPaysmart(code, periode, req) {
  const pool = req.sqlPool;
  if (!pool) return null;
  const [annee, mois] = periode.split('-');
  const moisPad = mois.padStart(2,'0');
  const pat = `'__/${moisPad}/${annee}%'`;

  if (code === 'AXE6_TX_SUCCES_PSM') {
    const r = await pool.request().query(`
      SELECT
        COUNT(*) AS TOTAL,
        SUM(CASE WHEN [Etat]='PAID' THEN 1 ELSE 0 END) AS PAID
      FROM [switchdb].[dbo].[TO_QLIK_BI_new]
      WHERE [Date] LIKE ${pat}`);
    const total = r.recordset[0]?.TOTAL || 0;
    const paid  = r.recordset[0]?.PAID  || 0;
    return total > 0 ? Math.round(paid / total * 1000) / 10 : null;
  }
  if (code === 'AXE6_NB_FACTURIERS') {
    const r = await pool.request().query(`
      SELECT COUNT(DISTINCT [Facturier]) AS NB
      FROM [switchdb].[dbo].[TO_QLIK_BI_new]
      WHERE [Etat]='PAID' AND [Date] LIKE ${pat}`);
    return Number(r.recordset[0]?.NB || 0);
  }
  if (code === 'AXE6_VOL_PSM') {
    const r = await pool.request().query(`
      SELECT SUM(CAST([Montant] AS FLOAT))/1000 AS VOL
      FROM [switchdb].[dbo].[TO_QLIK_BI_new]
      WHERE [Etat]='PAID' AND [Date] LIKE ${pat}`);
    return Number(r.recordset[0]?.VOL || 0);
  }
  return null;
}

// ── Adaptateur API Tokens ─────────────────────────────────────
async function adapterApi(code, periode, req) {
  if (code === 'AXE5_NB_PARTENAIRES') {
    const r = await query(
      `SELECT COUNT(DISTINCT user_id) AS nb
       FROM api_tokens WHERE actif=true AND expires_at > NOW()`, []
    );
    return Number(r.rows[0]?.nb || 0);
  }
  return null;
}

// ── Adaptateur SLA BPC ────────────────────────────────────────
async function adapterSla(code, periode, req) {
  if (code === 'AXE8_SLA_BPC') {
    const [annee, mois] = periode.split('-');
    const dateD = `${annee}-${mois}-01`;
    const lastDay = new Date(parseInt(annee), parseInt(mois), 0).getDate();
    const dateF   = `${annee}-${mois}-${String(lastDay).padStart(2,'0')}`;
    const r = await query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN statut='closed_on_time' THEN 1 ELSE 0 END) AS ok
      FROM sla_tickets
      WHERE created_at >= $1 AND created_at <= $2`,
      [dateD, dateF]
    );
    const total = Number(r.rows[0]?.total || 0);
    const ok    = Number(r.rows[0]?.ok    || 0);
    return total > 0 ? Math.round(ok / total * 1000) / 10 : null;
  }
  return null;
}

// ── Déclencher une alerte ─────────────────────────────────────
async function declencherAlerte(kpiId, periode, niveau, valeur, seuil) {
  try {
    // Compter les mois consécutifs en alerte
    const prev = await query(`
      SELECT COUNT(*) AS nb FROM kpi_alerte
      WHERE kpi_id=$1 AND niveau=$2 AND acquittee=false
        AND created_at >= NOW() - INTERVAL '3 months'`,
      [kpiId, niveau]
    );
    const moisConsecutifs = parseInt(prev.rows[0]?.nb || 0) + 1;

    await query(
      `INSERT INTO kpi_alerte (kpi_id, periode, niveau, valeur, seuil, mois_consecutifs)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING`,
      [kpiId, periode, niveau, valeur, seuil, moisConsecutifs]
    );
  } catch(e) {
    console.warn('[kpi] Alerte non enregistrée:', e.message);
  }
}

module.exports = router;
