// routes/switch.js — PAYSMART / SwitchBI SQL Server
const express = require('express');
const mssql   = require('mssql');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');

// ── Helper : clauses WHERE SQL Server ────────────────────
function buildSwitchWhere(f) {
  const conds  = [];
  const params = {};

  const toFrDate = iso => {
    if (!iso?.trim()) return null;
    const [y, m, d] = iso.trim().split('-');
    return `${d}/${m}/${y}`; // YYYY-MM-DD → DD/MM/YYYY
  };

  if (f.date_debut?.trim()) {
    const fr = toFrDate(f.date_debut);
    if (fr) { conds.push(`CONVERT(date,[Date],103) >= CONVERT(date,@date_debut,103)`); params.date_debut = { type: mssql.NVarChar(10), value: fr }; }
  }
  if (f.date_fin?.trim()) {
    const fr = toFrDate(f.date_fin);
    if (fr) { conds.push(`CONVERT(date,[Date],103) <= CONVERT(date,@date_fin,103)`);   params.date_fin   = { type: mssql.NVarChar(10), value: fr }; }
  }
  if (f.heure_debut?.trim()) { conds.push(`[Heure] >= @heure_debut`); params.heure_debut = { type: mssql.NVarChar(5), value: f.heure_debut.trim().slice(0,5) }; }
  if (f.heure_fin?.trim())   { conds.push(`[Heure] <= @heure_fin`);   params.heure_fin   = { type: mssql.NVarChar(5), value: f.heure_fin.trim().slice(0,5) }; }

  if (f.facturier && f.facturier !== 'ALL') { conds.push(`[Facturier]=@facturier`); params.facturier = { type: mssql.NVarChar(255), value: f.facturier }; }
  if (f.etat      && f.etat      !== 'ALL') { conds.push(`[Etat]=@etat`);           params.etat      = { type: mssql.NVarChar(255), value: f.etat }; }
  if (f.fsp       && f.fsp       !== 'ALL') { conds.push(`[FSP]=@fsp`);             params.fsp       = { type: mssql.NVarChar(255), value: f.fsp }; }

  if (f.canal?.trim())           { conds.push(`[Canal] LIKE @canal`);       params.canal           = { type: mssql.NVarChar(255), value: `%${f.canal.trim()}%` }; }
  if (f.solution?.trim())        { conds.push(`[Solution] LIKE @solution`);  params.solution        = { type: mssql.NVarChar(255), value: `%${f.solution.trim()}%` }; }
  if (f.moyen?.trim())           { conds.push(`[Moyen] LIKE @moyen`);        params.moyen           = { type: mssql.NVarChar(255), value: `%${f.moyen.trim()}%` }; }
  if (f.mode?.trim())            { conds.push(`[mode] LIKE @mode`);          params.mode            = { type: mssql.NVarChar(255), value: `%${f.mode.trim()}%` }; }
  if (f.ref_auto?.trim())        { conds.push(`[Reference Autorisation] LIKE @ref_auto`);       params.ref_auto        = { type: mssql.NVarChar(255), value: `%${f.ref_auto.trim()}%` }; }
  if (f.reference?.trim())       { conds.push(`[reference] LIKE @reference`);                   params.reference       = { type: mssql.NVarChar(255), value: `%${f.reference.trim()}%` }; }
  if (f.num_reservation?.trim()) { conds.push(`[Numéro de réservation] LIKE @num_reservation`); params.num_reservation = { type: mssql.NVarChar(255), value: `%${f.num_reservation.trim()}%` }; }

  if (f.montant_min !== null && f.montant_min !== undefined && f.montant_min !== '')
    { conds.push(`[Montant] >= @montant_min`); params.montant_min = { type: mssql.Float, value: parseFloat(f.montant_min) }; }
  if (f.montant_max !== null && f.montant_max !== undefined && f.montant_max !== '')
    { conds.push(`[Montant] <= @montant_max`); params.montant_max = { type: mssql.Float, value: parseFloat(f.montant_max) }; }

  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

function applyParams(sqlReq, params) {
  Object.entries(params).forEach(([k, v]) => sqlReq.input(k, v.type, v.value));
}

const SELECT_SWITCH = `
  CAST([Date] AS NVARCHAR(20)) AS [Date],
  RIGHT('0'+CAST(CAST(LEFT([Heure],2) AS INT)+1 AS NVARCHAR(2)),2)+':'+RIGHT([Heure],2) AS [Heure],
  [Client],[Facturier],[reference],[Montant],[ID Facture],
  [Numéro de réservation],[Etat],[FSP],[Canal],[Solution],
  [Moyen],[mode],[Reference Autorisation],[Motif de rejet],[sourceAccount]
`;

// ── GET /api/switch/dropdowns ────────────────────────────
router.get('/dropdowns', requireAuth, async (req, res) => {
  const pool = req.sqlPool;
  if (!pool) return res.status(503).json({ success: false, error: 'SQL Server non connecté — vérifiez MSSQL_* dans .env' });
  try {
    const [fsp, etat, facturier] = await Promise.all([
      pool.request().query(`SELECT DISTINCT [FSP]       AS val FROM [switchdb].[dbo].[TO_QLIK_BI_new] WHERE [FSP]       IS NOT NULL ORDER BY [FSP]`),
      pool.request().query(`SELECT DISTINCT [Etat]      AS val FROM [switchdb].[dbo].[TO_QLIK_BI_new] WHERE [Etat]      IS NOT NULL ORDER BY [Etat]`),
      pool.request().query(`SELECT DISTINCT [Facturier] AS val FROM [switchdb].[dbo].[TO_QLIK_BI_new] WHERE [Facturier] IS NOT NULL ORDER BY [Facturier]`),
    ]);
    res.json({
      success  : true,
      fsp      : fsp.recordset.map(r => r.val),
      etat     : etat.recordset.map(r => r.val),
      facturier: facturier.recordset.map(r => r.val)
    });
  } catch (err) {
    console.error('❌ switch/dropdowns:', err.message);
    // Retourner l'erreur détaillée pour diagnostic
    res.status(500).json({
      success: false,
      error  : err.message,
      code   : err.code,
      hint   : err.message.includes('Invalid object name')
        ? 'La table TO_QLIK_BI_new est introuvable — vérifiez le nom de la base et du schéma'
        : err.message.includes('Login failed')
        ? 'Identifiants SQL Server incorrects — vérifiez MSSQL_USER et MSSQL_PASSWORD'
        : err.message.includes('ECONNREFUSED') || err.message.includes('ESOCKET')
        ? 'Impossible de joindre SQL Server — vérifiez MSSQL_HOST et MSSQL_PORT'
        : 'Voir le terminal serveur pour plus de détails'
    });
  }
});

// ── POST /api/switch/transactions — paginé ───────────────
router.post('/transactions', requireAuth, async (req, res) => {
  const pool = req.sqlPool;
  if (!pool) return res.status(503).json({ success: false, error: 'SQL Server non connecté' });

  const { page = 1, pageSize = 50, table_mode, ...filters } = req.body;
  const offset = (page - 1) * pageSize;
  const { where, params } = buildSwitchWhere(filters);
  const table = table_mode === 'hist'
    ? '[switchdb].[dbo].[TO_QLIK_BI]'
    : '[switchdb].[dbo].[TO_QLIK_BI_new]';

  try {
    const cntReq = pool.request();
    applyParams(cntReq, params);
    const cntResult = await cntReq.query(`SELECT COUNT(*) AS total FROM ${table} ${where}`);
    const total = cntResult.recordset[0].total;

    const dataReq = pool.request();
    applyParams(dataReq, params);
    dataReq.input('offset',   mssql.Int, offset);
    dataReq.input('pageSize', mssql.Int, pageSize);
    const result = await dataReq.query(
      `SELECT ${SELECT_SWITCH} FROM ${table} ${where}
       ORDER BY CONVERT(date,[Date],103) DESC,[Heure] DESC
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`
    );

    res.json({
      success: true, total, page, pageSize,
      pages  : Math.ceil(total / pageSize),
      data   : result.recordset, table_mode
    });
  } catch (err) {
    console.error('Erreur switch/transactions:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/switch/export ───────────────────────────────
router.post('/export', requireAuth, async (req, res) => {
  const pool = req.sqlPool;
  if (!pool) return res.status(503).json({ success: false, error: 'SQL Server non connecté' });

  const { table_mode, ...rest } = req.body;
  const { where, params } = buildSwitchWhere(rest);
  const table = table_mode === 'hist'
    ? '[switchdb].[dbo].[TO_QLIK_BI]'
    : '[switchdb].[dbo].[TO_QLIK_BI_new]';

  try {
    const dataReq = pool.request();
    applyParams(dataReq, params);
    const result = await dataReq.query(
      `SELECT ${SELECT_SWITCH} FROM ${table} ${where}
       ORDER BY CONVERT(date,[Date],103) DESC,[Heure] DESC`
    );
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/switch/status ────────────────────────────────
router.get('/status', requireAuth, (req, res) => {
  res.json({ connected: !!req.sqlPool && req.sqlPool.connected !== false });
});

// ── GET /api/switch/diag ─────────────────────────────────
router.get('/diag', requireAuth, async (req, res) => {
  const pool = req.sqlPool;
  if (!pool) return res.status(503).json({ success: false, error: 'SQL Server non connecté' });
  try {
    const [cols, sample] = await Promise.all([
      pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TO_QLIK_BI_new'
          AND COLUMN_NAME IN ('Date','Heure','Montant')`),
      pool.request().query(`
        SELECT TOP 3 [Date],[Heure],
          CAST([Date]  AS VARCHAR(50)) AS date_str,
          CAST([Heure] AS VARCHAR(50)) AS heure_str
        FROM [switchdb].[dbo].[TO_QLIK_BI_new]`)
    ]);
    res.json({ columns: cols.recordset, sample: sample.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
