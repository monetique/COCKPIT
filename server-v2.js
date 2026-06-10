// server-v2.js — ClicToPay Monitoring Dashboard v2.0
// Architecture : Express modulaire + PostgreSQL + JWT + Oracle + SQL Server
'use strict';
require('dotenv').config();

// ── Logger structuré (Winston) — AVANT TOUT ──────────────
const {
  logger, logError, logWarn, httpLogger, redirectConsole, LOG_DIR
} = require('./config/logger');

// Rediriger console.* vers Winston
redirectConsole();

// ── Protection contre les crashs non gérés ────────────────
process.on('uncaughtException', err => {
  logError('uncaughtException', err, { action: 'PROCESS_ERROR' });
});
process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)), { action: 'PROCESS_ERROR' });
});

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const oracledb = require('oracledb');
const mssql    = require('mssql');

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';   // écoute sur toutes les interfaces réseau

// ── CORS — origines autorisées ────────────────────────────
// CORS_ORIGIN peut contenir plusieurs origines séparées par une virgule
// Ex : CORS_ORIGIN=http://192.168.1.50:3000,http://monserveur.local:3000
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Si CORS_ORIGIN vide ou = * → tout autoriser (pratique en réseau interne)
const corsOptions = {
  origin: (origin, callback) => {
    // Requêtes sans origin (Postman, appels serveur à serveur, curl)
    if (!origin) return callback(null, true);
    // Wildcard
    if (allowedOrigins.includes('*') || allowedOrigins.length === 0)
      return callback(null, true);
    if (allowedOrigins.includes(origin))
      return callback(null, true);
    // Autoriser aussi localhost sous toutes ses formes
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      return callback(null, true);
    callback(new Error(`CORS bloqué : ${origin}`));
  },
  credentials: true,
};

// ── Middlewares globaux ────────────────────────────────────
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Timeout étendu pour les opérations longues (import Excel)
app.use('/api/tracking/import', (req, res, next) => {
  res.setTimeout(300000); // 5 minutes pour l'import
  next();
});

// Timeout étendu pour les routes d'import (10 minutes)
app.use((req, res, next) => {
  if (req.path.includes('/import') || req.path.includes('/export')) {
    req.setTimeout(600000);   // 10 min
    res.setTimeout(600000);
  }
  next();
});

// Log HTTP structuré (Winston) — toutes les requêtes API
app.use(httpLogger);

// ── Connexions BDD ─────────────────────────────────────────
require('./db/postgres'); // PostgreSQL — auto-connect au require

let oraclePool         = null;
let merchantsProdPool  = null;
let merchantsTestPool  = null;
let sqlPool            = null;

async function initOracleBPC() {
  try {
    oraclePool = await oracledb.createPool({
      user         : process.env.DB_USER,
      password     : process.env.DB_PASSWORD,
      connectString: `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_SERVICE}`,
      poolMin: 2, poolMax: 10, poolIncrement: 1,
      poolAlias: 'bpc'   // ← alias unique pour éviter les conflits
    });
    console.log('✅ Oracle BPC connecté');
  } catch (err) { console.error('❌ Oracle BPC:', err.message); }
}

async function initOracleMerchantsProd() {
  try {
    merchantsProdPool = await oracledb.createPool({
      user         : process.env.MERCHANTS_PROD_USER,
      password     : process.env.MERCHANTS_PROD_PASSWORD,
      connectString: `${process.env.MERCHANTS_PROD_HOST}:${process.env.MERCHANTS_PROD_PORT}/${process.env.MERCHANTS_PROD_SERVICE}`,
      poolMin: 1, poolMax: 5, poolIncrement: 1, poolAlias: 'merchants_prod'
    });
    console.log('✅ Oracle Merchants PROD connecté');
  } catch (err) { console.error('❌ Oracle Merchants PROD:', err.message); }
}

async function initOracleMerchantsTest() {
  try {
    merchantsTestPool = await oracledb.createPool({
      user         : process.env.MERCHANTS_TEST_USER,
      password     : process.env.MERCHANTS_TEST_PASSWORD,
      connectString: `${process.env.MERCHANTS_TEST_HOST}:${process.env.MERCHANTS_TEST_PORT}/${process.env.MERCHANTS_TEST_SERVICE}`,
      poolMin: 1, poolMax: 10, poolIncrement: 1, poolAlias: 'merchants_test',
      queueTimeout: 120000
    });
    console.log('✅ Oracle Merchants TEST connecté');
  } catch (err) { console.error('❌ Oracle Merchants TEST:', err.message); }
}

async function initSqlServer() {
  try {
    sqlPool = await mssql.connect({
      user    : process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      server  : process.env.MSSQL_HOST,
      port    : parseInt(process.env.MSSQL_PORT || '1433'),
      database: process.env.MSSQL_DATABASE || 'switchdb',
      options : { encrypt: false, trustServerCertificate: true, enableArithAbort: true, useUTC: false },
      pool    : { max: 10, min: 2, idleTimeoutMillis: 30000 },
      requestTimeout    : 120000,
      connectionTimeout : 30000
    });
    console.log('✅ SQL Server PAYSMART connecté');
  } catch (err) { console.error('❌ SQL Server:', err.message); }
}

// Injecter les pools dans req pour les routes qui en ont besoin
app.use((req, res, next) => {
  // Bypass auth pour les appels internes du scheduler
  if (req.headers['x-internal-scheduler'] === 'true') {
    req.user = { id: 'scheduler', role: 'admin', email: 'scheduler@internal' };
  }
  req.oraclePool        = oraclePool;
  req.merchantsProdPool = merchantsProdPool;
  req.merchantsTestPool = merchantsTestPool;
  req.sqlPool           = sqlPool;
  next();
});

// ── Routes API ─────────────────────────────────────────────
const { requireAuth } = require('./middleware/auth');

// Auth — public (pas de requireAuth ici)
app.use('/api/auth', require('./routes/auth'));

// Toutes les autres routes nécessitent un token JWT valide
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/switch',       require('./routes/switch'));
app.use('/api/merchants',    require('./routes/merchants'));
app.use('/api/banks',        require('./routes/banks'));
app.use('/api/validations',  require('./routes/validations'));
// ── DELETE /api/tracking/:processing_id (suppression marchand) ──
app.delete('/api/tracking/:processing_id', requireAuth, async (req, res) => {
  const { processing_id } = req.params;
  const { query } = require('./db/postgres');
  const { logAction } = require('./middleware/audit');
  try {
    const result = await query(
      `DELETE FROM merchants_tracking WHERE processing_id = $1 RETURNING processing_id, raison_sociale`,
      [processing_id]
    );
    if (!result.rows[0])
      return res.status(404).json({ success: false, error: `Marchand ${processing_id} introuvable` });
    await logAction(req, 'DELETE_MERCHANT', `merchant:${processing_id}`, { raison_sociale: result.rows[0].raison_sociale });
    console.log(`🗑  Supprimé : ${processing_id} — ${result.rows[0].raison_sociale}`);
    res.json({ success: true, deleted: processing_id, raison_sociale: result.rows[0].raison_sociale });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.use('/api/tracking',     require('./routes/merchants-tracking'));
app.use('/api/cahiers',      require('./routes/cahiers'));
app.use('/api/acs',         require('./routes/acs'));
app.use('/api/alerts',      require('./routes/alerts'));
app.use('/api/sla',           require('./routes/sla'));
app.use('/api/email-preview', require('./routes/email-preview'));
app.use('/api/banques-dashboard', require('./routes/banques-dashboard'));
app.use('/api/psm-facturation', require('./routes/psm_facturation'));
app.use('/api/facturation-globale', require('./routes/facturation_globale'));
app.use('/api/facturation', require('./routes/facturation'));
app.use('/api/reconciliation', require('./routes/reconciliation'));
app.use('/api/rapports', require('./routes/rapports'));
app.use('/api/inscriptions',      require('./routes/inscriptions'));
app.use('/api/provision-uat',     require('./routes/provision-uat'));
app.use('/api/api-tokens',  require('./routes/api-tokens'));
app.use('/api/payfacs',     require('./routes/payfacs'));
const { router: versionRouter, registerVersion } = require('./routes/version');
app.use('/api/users', require('./routes/users'));
app.use('/api/kpi', require('./routes/kpi'));
app.use('/api/version', versionRouter);
app.use('/api/logs',        require('./routes/logs'));
// API publique v1 — authentification par X-API-Key
app.use('/api/v1/affiliates', require('./routes/v1-affiliates'));

// Config SMTP CC
app.get('/api/config/smtp-cc', requireAuth, (req, res) => {
  res.json({ success: true, cc: process.env.SMTP_CC || '' });
});

// ── Health check ──────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const { pool: pgPool } = require('./db/postgres');
  let pgOk = false;
  try { await pgPool.query('SELECT 1'); pgOk = true; } catch {}
  res.json({
    status   : 'ok',
    timestamp: new Date().toISOString(),
    version  : '2.0',
    services : {
      postgresql   : pgOk             ? 'up' : 'down',
      oracle_bpc   : oraclePool       ? 'up' : 'down',
      oracle_prod  : merchantsProdPool? 'up' : 'down',
      oracle_test  : merchantsTestPool? 'up' : 'down',
      sql_server   : sqlPool          ? 'up' : 'down',
    }
  });
});

// ── Frontend ───────────────────────────────────────────────
// Production : npm run build dans frontend/ → dist/ servi ici
// Développement : Vite tourne sur port 5173 (CORS_ORIGIN=http://localhost:5173)
const distPath = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  // Assets JS/CSS : cache long (ils ont un hash dans le nom)
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  // index.html : jamais en cache (pour forcer le rechargement du bon bundle)
  app.use(express.static(distPath, { maxAge: 0, etag: false }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log('React SPA servi depuis frontend/dist/');
} else {
  // Fallback HTML v1 pendant la migration
  const publicPath = path.join(__dirname, 'public');
  if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
    console.log('HTML v1 servi depuis public/ (mode migration)');
  }
}

// ── Handlers globaux ──────────────────────────────────────
// ── Scheduler UAT — retry SQL pour les dossiers api_ok ───
// Toutes les 2 minutes, retente l'étape 2 pour les marchands
// dont l'étape 1 (API) a réussi mais l'étape 2 (SQL) est en attente
(function startUatRetryScheduler() {
  const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

  const runRetry = async () => {
    try {
      const { query } = require('./db/postgres');
      const pending = await query(
        `SELECT processing_id, uat_merchant_id
         FROM merchants_tracking
         WHERE uat_status = 'api_ok'
           AND uat_merchant_id IS NOT NULL
           AND (uat_last_attempt_at IS NULL OR uat_last_attempt_at < NOW() - INTERVAL '3 minutes')
         LIMIT 5`,
        []
      );
      if (!pending.rows.length) return;

      console.log(`[UAT Scheduler] ${pending.rows.length} dossier(s) api_ok à retenter`);
      const { retrySqlOnly } = require('./routes/provision-uat');
      // retrySqlOnly n'est pas exportée — on passe par runProvision avec flag
      for (const row of pending.rows) {
        try {
          await query(
            `UPDATE merchants_tracking SET uat_last_attempt_at=NOW() WHERE processing_id=$1`,
            [row.processing_id]
          );
          const { runProvision } = require('./routes/provision-uat');
          // On ne refait que le SQL en passant directement par la logique interne
          const result = await runProvision(row.processing_id, 'scheduler:uat-retry');
          if (result.success) {
            console.log(`[UAT Scheduler] ✅ ${row.processing_id} provisionné`);
          } else if (result.step === 'sql_pending') {
            console.log(`[UAT Scheduler] ⏳ ${row.processing_id} toujours en attente Oracle`);
          } else {
            console.warn(`[UAT Scheduler] ❌ ${row.processing_id}: ${result.error}`);
          }
        } catch(e) {
          console.error(`[UAT Scheduler] Exception ${row.processing_id}:`, e.message);
        }
      }
    } catch(e) {
      console.error('[UAT Scheduler]', e.message);
    }
  };

  setInterval(runRetry, INTERVAL_MS);
  console.log('[UAT Scheduler] ✅ Démarré — retry toutes les 2 minutes');

  // Scheduler rapport inscriptions
  try {
    require('./schedulers/rapport-inscriptions').start(app);
  } catch(e) {
    console.warn('[rapport-cron] Scheduler non demarre:', e.message);
  }
})();
// Lance un scan automatique des dossiers en retard
(function startSlaScheduler() {
  const { runSlaCheck } = require('./routes/sla');
  const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 heures

  const runCheck = async () => {
    console.log('[SLA Scheduler] Lancement de la vérification SLA...');
    try {
      const result = await runSlaCheck({ triggeredBy: 'scheduler' });
      if (result.success) {
        console.log(`[SLA Scheduler] ✅ ${result.total_late} dossiers en retard | ${result.alerts_sent} alertes envoyées | ${result.alerts_skipped} en cooldown`);
      } else {
        console.error('[SLA Scheduler] ❌ Erreur:', result.error);
      }
    } catch(e) {
      console.error('[SLA Scheduler] ❌ Exception:', e.message);
    }
  };

  // Premier lancement 5 minutes après le démarrage du serveur
  setTimeout(() => {
    runCheck();
    setInterval(runCheck, INTERVAL_MS);
  }, 5 * 60 * 1000);

  console.log('[SLA Scheduler] ✅ Démarré — vérification toutes les 6h');
})();

  // ── Scheduler KPI Stratégie 2027-2030 ──────────────────
  try {
    const { startKpiScheduler } = require('./schedulers/kpi-scheduler');
    startKpiScheduler({ oraclePool, sqlPool });
  } catch(e) {
    console.warn('[kpi-scheduler] Non démarré:', e.message);
  }

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `Route inconnue : ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error('❌ Erreur non gérée:', err.message);
  res.status(500).json({ success: false, error: 'Erreur serveur interne' });
});

// ── Gestionnaire d'erreurs global Express ─────────────────
app.use((err, req, res, next) => {
  logError('Erreur Express non geree', err, {
    action  : 'EXPRESS_ERROR',
    user    : req.user?.email || null,
    resource: req.path,
    ip      : req.ip,
  });
  res.status(500).json({ success: false, error: 'Erreur serveur interne' });
});

// ── Démarrage ─────────────────────────────────────────────
async function start() {
  logger.info('SMT COCKPIT v2.0 - Demarrage', {
    action: 'SERVER_START',
    port  : PORT,
    host  : HOST,
    env   : process.env.NODE_ENV || 'development',
    logDir: LOG_DIR,
  });

  await Promise.allSettled([
    initOracleBPC(),
    initOracleMerchantsProd(),
    initOracleMerchantsTest(),
    initSqlServer(),
  ]);

  app.listen(PORT, HOST, () => {
    registerVersion();
    logger.info(`Serveur en ecoute sur ${HOST}:${PORT}`, {
      action  : 'SERVER_READY',
      url     : `http://localhost:${PORT}`,
      network : `http://<IP_SERVEUR>:${PORT}`,
      health  : `http://localhost:${PORT}/api/health`,
    });

    // ── Scheduler rapport inscriptions (toutes les heures) ──
    try {
      // rapport scheduler démarré plus haut
    } catch(e) {
      logger.warn('[rapport-cron] Scheduler non demarre: ' + e.message);
    }
  });
}

start().catch(err => {
  logError('Demarrage impossible', err, { action: 'SERVER_START_FAILED' });
  process.exit(1);
});