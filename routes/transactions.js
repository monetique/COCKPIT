// routes/transactions.js — Transactions BPC Oracle
const express  = require('express');
const oracledb = require('oracledb');
const router   = express.Router();
const { requireAuth } = require('../middleware/auth');

// ── Helper : connexion via pool BPC injecté ───────────────
async function getConn(req) {
  if (req.oraclePool) return await req.oraclePool.getConnection();
  return await oracledb.getConnection('bpc');
}

// ── Helper WHERE ──────────────────────────────────────────
function buildWhere(f) {
  const c = [], b = {};

  // ⚠️ 90M lignes — filtre date obligatoire par défaut (7 jours)
  // Préfixe T. pour éviter les ambiguïtés avec la JOIN BPCMERCHANTDETAILS
  if (f.date_debut) {
    c.push(`T.TRANS_DATE >= TO_DATE(:dd,'DD/MM/YYYY')`); b.dd = f.date_debut;
  } else if (!f.date_fin) {
    c.push(`T.TRANS_DATE >= SYSDATE - 7`);
  }

  if (f.date_fin)              { c.push(`T.TRANS_DATE <= TO_DATE(:df,'DD/MM/YYYY')+1-1/86400`); b.df  = f.date_fin; }
  if (f.order_number?.trim())  { c.push(`UPPER(T.ORDERNUMBER) LIKE UPPER(:on)`);                b.on  = `%${f.order_number.trim()}%`; }
  if (f.ip?.trim())            { c.push(`T.IP LIKE :ip`);                                       b.ip  = `%${f.ip.trim()}%`; }
  if (f.auth_code?.trim())     { c.push(`UPPER(T.AUTH_CODE) LIKE UPPER(:ac)`);                  b.ac  = `%${f.auth_code.trim()}%`; }
  if (f.payment_state && f.payment_state !== 'ALL') { c.push(`T.PAYMENT_STATE = :ps`);          b.ps  = f.payment_state; }
  if (f.processing_id?.trim()) { c.push(`UPPER(T.PROCESSING_ID) LIKE UPPER(:pi)`);              b.pi  = `%${f.processing_id.trim()}%`; }
  if (f.pan?.trim())           { c.push(`T.PAN LIKE :pan`);                                     b.pan = `%${f.pan.trim()}%`; }
  return { w: c.length ? 'WHERE ' + c.join(' AND ') : '', b };
}

// ── GET /api/transactions/columns ────────────────────────
router.get('/columns', requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn(req);
    const r = await conn.execute(
      `SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS
       WHERE TABLE_NAME='BPCTRANSACTIONS' ORDER BY COLUMN_ID`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, columns: r.rows });
  } catch(e) { res.status(500).json({ success:false, error: e.message }); }
  finally    { if(conn) await conn.close().catch(()=>{}); }
});

// ── GET /api/transactions/states ─────────────────────────
router.get('/states', requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn(req);
    const r = await conn.execute(
      `SELECT DISTINCT PAYMENT_STATE FROM BPCTRANSACTIONS
       WHERE PAYMENT_STATE IS NOT NULL ORDER BY PAYMENT_STATE`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, data: r.rows.map(x => x.PAYMENT_STATE) });
  } catch(e) { res.status(500).json({ success:false, error: e.message }); }
  finally    { if(conn) await conn.close().catch(()=>{}); }
});

// ── GET /api/transactions/ping — test connexion simple ────
router.get('/ping', requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn(req);
    // Requête minimale — COUNT sans aucun filtre ni expression complexe
    const r = await conn.execute(
      `SELECT COUNT(*) AS TOTAL FROM BPCTRANSACTIONS`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, total: r.rows[0].TOTAL,
               pool: req.oraclePool ? 'req.oraclePool' : 'alias bpc' });
  } catch(e) {
    console.error('ping error:', e.message);
    res.status(500).json({ success:false, error: e.message });
  }
  finally { if(conn) await conn.close().catch(()=>{}); }
});

// ── GET /api/transactions/test-pan — test masquage PAN ───
router.get('/test-pan', requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn(req);
    // Test masquage PAN sur 1 seule ligne
    const r = await conn.execute(
      `SELECT ORDERNUMBER, PAYMENT_STATE, PROCESSING_ID,
              SUBSTR(PAN,1,6) || '******' || SUBSTR(PAN,-4) AS CARTE_MASQUEE,
              TRANS_DATE, AMOUNT, AUTH_CODE
       FROM BPCTRANSACTIONS
       WHERE ROWNUM = 1`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, sample: r.rows });
  } catch(e) {
    console.error('test-pan error:', e.message);
    res.status(500).json({ success:false, error: e.message });
  }
  finally { if(conn) await conn.close().catch(()=>{}); }
});

// ── POST /api/transactions — paginé ──────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { page=1, pageSize=50, ...filters } = req.body;
  const { w, b } = buildWhere(filters);
  const offset   = (page-1) * pageSize;

  // Log requête lisible dans la console
  let whereDisplay = w;
  Object.entries(b).forEach(([k, v]) => {
    whereDisplay = whereDisplay.replace(new RegExp(':' + k + '\\b', 'g'), `'${v}'`);
  });
  console.log(`\n📋 /transactions POST — page ${page}/${Math.ceil(1/pageSize)}`);
  console.log(`   ${whereDisplay || '(sans filtre)'}`);
  console.log(`   OFFSET ${offset} FETCH NEXT ${pageSize}`);

  let conn;
  try {
    conn = await getConn(req);

    const FROM_JOIN = `FROM BPCTRANSACTIONS T
      INNER JOIN BPCMERCHANTDETAILS M ON T.MERCHANT_ID = M.ID`;

    // 1. COUNT avec JOIN
    const cnt = await conn.execute(
      `SELECT COUNT(*) AS TOTAL ${FROM_JOIN} ${w}`,
      b, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const total = cnt.rows[0].TOTAL;

    // 2. DATA — pagination Oracle avec JOIN BPCMERCHANTDETAILS
    const dat = await conn.execute(`
      SELECT TRANS_DATE, ORDERNUMBER, AMOUNT, APPROVEDAMOUNT, DEPOSITEDAMOUNT,
             REFUNDEDAMOUNT, CURRENCY, CARTE_MASQUEE, PAYMENT_STATE, CURRENTSTATE,
             PAYMENT_STATE_EXTENSION, AUTHORIZATION_RESPONSE_ID, AUTH_CODE,
             ACTION_CODE_INT, ORIGINAL_ACTION_CODE, REFERENCE_NUMBER, STAN,
             TRANS_ID, PROCESSING_ID, TERMINAL_ID, MERCHANT_ID, IP, IP_COUNTRY_CODE,
             BANK_NAME, ECI, PAYMENT_SYSTEM, DEVICE_CHANNEL, PAYMENT_WAY,
             PAYMENT_DATE, DEPOSITED_DATE, FRAUD_MARK, TEXT, LANGUAGE, NODE_ID,
             MERCHANTFULLNAME, MCC
      FROM (
        SELECT
          T.TRANS_DATE,
          T.ORDERNUMBER,
          T.AMOUNT,
          T.APPROVEDAMOUNT,
          T.DEPOSITEDAMOUNT,
          T.REFUNDEDAMOUNT,
          T.CURRENCY,
          SUBSTR(T.PAN,1,6) || '******' || SUBSTR(T.PAN,-4) AS CARTE_MASQUEE,
          T.PAYMENT_STATE,
          T.CURRENTSTATE,
          T.PAYMENT_STATE_EXTENSION,
          T.AUTHORIZATION_RESPONSE_ID,
          T.AUTH_CODE,
          T.ACTION_CODE_INT,
          T.ORIGINAL_ACTION_CODE,
          T.REFERENCE_NUMBER,
          T.STAN,
          T.TRANS_ID,
          T.PROCESSING_ID,
          T.TERMINAL_ID,
          T.MERCHANT_ID,
          T.IP,
          T.IP_COUNTRY_CODE,
          T.BANK_NAME,
          T.ECI,
          T.PAYMENT_SYSTEM,
          T.DEVICE_CHANNEL,
          T.PAYMENT_WAY,
          T.PAYMENT_DATE,
          T.DEPOSITED_DATE,
          T.FRAUD_MARK,
          T.TEXT,
          T.LANGUAGE,
          T.NODE_ID,
          M.MERCHANTFULLNAME,
          M.MCC,
          ROWNUM AS RN
        FROM BPCTRANSACTIONS T
        INNER JOIN BPCMERCHANTDETAILS M ON T.MERCHANT_ID = M.ID
        ${w}
        ORDER BY T.TRANS_DATE DESC
      )
      WHERE RN > :minRow AND RN <= :maxRow`,
      { ...b, maxRow: offset+pageSize, minRow: offset },
      { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchArraySize: 200 }
    );

    res.json({ success:true, total, page, pageSize,
               pages: Math.ceil(total/pageSize), data: dat.rows });
  } catch(e) {
    console.error('Erreur /transactions POST:', e.message);
    // Répondre avec l'erreur — ne pas laisser la connexion ouverte
    res.status(500).json({ success:false, error: e.message });
  } finally {
    if(conn) await conn.close().catch(e2 => console.error('close err:', e2.message));
  }
});

// ── GET /api/transactions/states-count — diagnostic ──────
// Retourne les états distincts avec leur nombre de lignes
router.get('/states-count', requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn(req);
    const r = await conn.execute(
      `SELECT PAYMENT_STATE, COUNT(*) AS N
       FROM BPCTRANSACTIONS
       WHERE TRANS_DATE >= SYSDATE - 1
       GROUP BY PAYMENT_STATE
       ORDER BY N DESC`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log('\n🔍 États PAYMENT_STATE réels :');
    r.rows.forEach(row => console.log(`   "${row.PAYMENT_STATE}" : ${row.N}`));
    res.json({ success: true, states: r.rows });
  } catch(e) {
    res.status(500).json({ success:false, error: e.message });
  } finally {
    if(conn) await conn.close().catch(()=>{});
  }
});

// ── POST /api/transactions/stats — KPIs agrégés ──────────
router.post('/stats', requireAuth, async (req, res) => {
  const { w, b } = buildWhere(req.body);

  const sqlStats = `
      SELECT
        COUNT(*)  AS TOTAL,
        NVL(SUM(CASE WHEN TRIM(PAYMENT_STATE) = 'payment_deposited' THEN 1 ELSE 0 END), 0) AS DEPOSITED,
        NVL(SUM(CASE WHEN TRIM(PAYMENT_STATE) = 'payment_declined'  THEN 1 ELSE 0 END), 0) AS DECLINED,
        NVL(SUM(CASE WHEN TRIM(PAYMENT_STATE) = 'started'           THEN 1 ELSE 0 END), 0) AS STARTED,
        NVL(SUM(CASE WHEN TRIM(PAYMENT_STATE) NOT IN ('payment_deposited','payment_declined','started')
                 THEN 1 ELSE 0 END), 0)                                                     AS OTHERS,
        NVL(SUM(CASE WHEN TRIM(PAYMENT_STATE) = 'payment_deposited' THEN AMOUNT ELSE 0 END), 0) AS TOTAL_AMOUNT,
        NVL(AVG(CASE WHEN TRIM(PAYMENT_STATE) = 'payment_deposited' AND AMOUNT > 0 THEN AMOUNT END), 0) AS AVG_AMOUNT,
        NVL(MAX(AMOUNT), 0)                                     AS MAX_AMOUNT,
        NVL(MIN(CASE WHEN AMOUNT > 0 THEN AMOUNT END), 0)       AS MIN_AMOUNT
      FROM BPCTRANSACTIONS T
      INNER JOIN BPCMERCHANTDETAILS M ON T.MERCHANT_ID = M.ID
      ${w}`.trim();

  const sqlActionCodes = `
      SELECT T.ACTION_CODE_INT AS CODE,
             TO_CHAR(T.ACTION_CODE_INT) AS LABEL,
             COUNT(*) AS CNT
      FROM BPCTRANSACTIONS T
      INNER JOIN BPCMERCHANTDETAILS M ON T.MERCHANT_ID = M.ID
      ${w}
        AND T.ACTION_CODE_INT IS NOT NULL
        AND T.ACTION_CODE_INT <> 0
      GROUP BY T.ACTION_CODE_INT
      ORDER BY CNT DESC
      FETCH FIRST 8 ROWS ONLY`.trim();

  const sqlMerchants = `
      SELECT NVL(M.MERCHANTFULLNAME, T.PROCESSING_ID) AS NAME,
             COUNT(*) AS CNT
      FROM BPCTRANSACTIONS T
      INNER JOIN BPCMERCHANTDETAILS M ON T.MERCHANT_ID = M.ID
      ${w}
      GROUP BY NVL(M.MERCHANTFULLNAME, T.PROCESSING_ID)
      ORDER BY CNT DESC
      FETCH FIRST 8 ROWS ONLY`.trim();

  // Reconstituer la requête lisible
  let sqlDisplay = sqlStats;
  Object.entries(b).forEach(([k, v]) => {
    sqlDisplay = sqlDisplay.replace(new RegExp(':' + k + '\\b', 'g'), `'${v}'`);
  });

  console.log('\n📊 /transactions/stats — Requête Oracle :');
  console.log(sqlDisplay);
  console.log('Bind vars:', JSON.stringify(b));
  console.log('');

  let conn;
  try {
    conn = await getConn(req);
    const [rStats, rAC, rMch] = await Promise.all([
      conn.execute(sqlStats, b, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
      conn.execute(sqlActionCodes, b, { outFormat: oracledb.OUT_FORMAT_OBJECT }).catch(() => ({ rows: [] })),
      conn.execute(sqlMerchants,   b, { outFormat: oracledb.OUT_FORMAT_OBJECT }).catch(() => ({ rows: [] })),
    ]);
    const row = rStats.rows[0];
    res.json({
      success       : true,
      total         : row.TOTAL,
      deposited     : row.DEPOSITED,
      declined      : row.DECLINED,
      started       : row.STARTED,
      others        : row.OTHERS,
      totalAmount   : row.TOTAL_AMOUNT,
      avgAmount     : row.AVG_AMOUNT,
      maxAmount     : row.MAX_AMOUNT,
      minAmount     : row.MIN_AMOUNT,
      topActionCodes: rAC.rows.map(r => ({ code: r.CODE, label: r.LABEL, count: r.CNT })),
      topMerchants  : rMch.rows.map(r => ({ name: r.NAME, count: r.CNT })),
      _sql          : sqlDisplay,
      _binds        : b,
    });
  } catch(e) {
    console.error('Erreur /transactions/stats:', e.message);
    res.status(500).json({ success:false, error: e.message, _sql: sqlDisplay });
  } finally {
    if(conn) await conn.close().catch(()=>{});
  }
});

// ── POST /api/transactions/export ────────────────────────
router.post('/export', requireAuth, async (req, res) => {
  const { w, b } = buildWhere(req.body);
  let conn;
  try {
    conn = await getConn(req);
    const r = await conn.execute(`
      SELECT
        T.TRANS_DATE,
        T.ORDERNUMBER,
        T.AMOUNT,
        T.APPROVEDAMOUNT,
        T.DEPOSITEDAMOUNT,
        T.CURRENCY,
        SUBSTR(T.PAN,1,6) || '******' || SUBSTR(T.PAN,-4) AS CARTE_MASQUEE,
        T.PAYMENT_STATE,
        T.AUTHORIZATION_RESPONSE_ID,
        T.AUTH_CODE,
        T.ACTION_CODE_INT,
        T.REFERENCE_NUMBER,
        T.STAN,
        T.PROCESSING_ID,
        T.TERMINAL_ID,
        T.IP,
        T.BANK_NAME,
        T.ECI,
        T.PAYMENT_SYSTEM,
        T.DEVICE_CHANNEL,
        T.PAYMENT_DATE,
        T.DEPOSITED_DATE,
        T.FRAUD_MARK,
        T.TEXT,
        M.MERCHANTFULLNAME,
        M.MCC
      FROM BPCTRANSACTIONS T
      INNER JOIN BPCMERCHANTDETAILS M ON T.MERCHANT_ID = M.ID
      ${w}
      ORDER BY T.TRANS_DATE DESC`,
      b, { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchArraySize: 1000 }
    );
    res.json({ success:true, data: r.rows });
  } catch(e) {
    res.status(500).json({ success:false, error: e.message });
  } finally {
    if(conn) await conn.close().catch(()=>{});
  }
});

module.exports = router;
