// config/logger.js
// Système de logging structuré — Winston
// Niveaux : error | warn | info | http | debug
// Fichiers rotatifs dans logs/ avec format JSON standard

'use strict';

const winston  = require('winston');
const DailyRot = require('winston-daily-rotate-file');
const path     = require('path');
const fs       = require('fs');

// ── Répertoire des logs ───────────────────────────────────
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ── Niveau selon l'environnement ─────────────────────────
const LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// ── Format JSON structuré ─────────────────────────────────
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ── Format console lisible (développement) ────────────────
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, action, user, resource, ip, duration, ...meta }) => {
    let line = `${timestamp} [${level}]`;
    if (action)   line += ` [${action}]`;
    if (user)     line += ` user:${user}`;
    if (resource) line += ` res:${resource}`;
    if (ip)       line += ` ip:${ip}`;
    if (duration) line += ` (${duration}ms)`;
    line += ` ${message}`;
    const extra = Object.keys(meta).filter(k => k !== 'stack' && k !== 'service');
    if (extra.length) line += ` | ${JSON.stringify(Object.fromEntries(extra.map(k => [k, meta[k]])))}`;
    return line;
  })
);

// ── Transports ────────────────────────────────────────────

// 1. Tous les logs (info+) — rotation quotidienne
const allLogsTransport = new DailyRot({
  filename    : path.join(LOG_DIR, 'smt-cockpit-%DATE%.log'),
  datePattern : 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize     : '20m',
  maxFiles    : '30d',       // garder 30 jours
  level       : 'info',
  format      : jsonFormat,
});

// 2. Erreurs uniquement — rotation quotidienne
const errorLogsTransport = new DailyRot({
  filename    : path.join(LOG_DIR, 'smt-cockpit-errors-%DATE%.log'),
  datePattern : 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize     : '10m',
  maxFiles    : '90d',       // garder 90 jours pour les erreurs
  level       : 'error',
  format      : jsonFormat,
});

// 3. Actions utilisateurs — rotation quotidienne
const actionsTransport = new DailyRot({
  filename    : path.join(LOG_DIR, 'smt-cockpit-actions-%DATE%.log'),
  datePattern : 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize     : '20m',
  maxFiles    : '90d',
  level       : 'info',
  format      : jsonFormat,
});

// 4. Requêtes HTTP — rotation quotidienne
const httpTransport = new DailyRot({
  filename    : path.join(LOG_DIR, 'smt-cockpit-http-%DATE%.log'),
  datePattern : 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize     : '50m',
  maxFiles    : '14d',       // 14 jours pour les HTTP
  level       : 'http',
  format      : jsonFormat,
});

// ── Création du logger principal ──────────────────────────
const logger = winston.createLogger({
  level      : LEVEL,
  defaultMeta: { service: 'smt-cockpit' },
  transports : [
    allLogsTransport,
    errorLogsTransport,
    httpTransport,
    // Console uniquement si pas en production ou si LOG_CONSOLE=true
    ...(process.env.NODE_ENV !== 'production' || process.env.LOG_CONSOLE === 'true'
      ? [new winston.transports.Console({
          level : LEVEL,
          format: consoleFormat,
        })]
      : []),
  ],
  // Ne pas quitter sur les erreurs non gérées
  exitOnError: false,
});

// ── Logger dédié aux actions utilisateurs ────────────────
const actionLogger = winston.createLogger({
  level      : 'info',
  defaultMeta: { service: 'smt-cockpit', type: 'user_action' },
  transports : [
    actionsTransport,
    allLogsTransport,
  ],
  exitOnError: false,
});

// ── Helpers ───────────────────────────────────────────────

/**
 * Log une action utilisateur
 * @param {string} action    — ex: 'LOGIN', 'IMPORT_EXCEL', 'DELETE_MERCHANT'
 * @param {object} ctx       — { user, ip, resource, details }
 */
function logUserAction(action, ctx = {}) {
  actionLogger.info(`Action: ${action}`, {
    action,
    user    : ctx.user     || 'system',
    ip      : ctx.ip       || null,
    resource: ctx.resource || null,
    details : ctx.details  || {},
  });
}

/**
 * Log une erreur applicative
 */
function logError(message, err, ctx = {}) {
  logger.error(message, {
    error   : err?.message || String(err),
    stack   : err?.stack   || null,
    action  : ctx.action   || null,
    user    : ctx.user     || null,
    resource: ctx.resource || null,
    ip      : ctx.ip       || null,
    details : ctx.details  || {},
  });
}

/**
 * Log un avertissement
 */
function logWarn(message, ctx = {}) {
  logger.warn(message, {
    action  : ctx.action   || null,
    user    : ctx.user     || null,
    resource: ctx.resource || null,
    details : ctx.details  || {},
  });
}

/**
 * Middleware Express — log toutes les requêtes HTTP
 */
function httpLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level    = res.statusCode >= 500 ? 'error'
                   : res.statusCode >= 400 ? 'warn'
                   : 'http';
    logger.log(level, `${req.method} ${req.path}`, {
      type    : 'http',
      method  : req.method,
      path    : req.originalUrl || req.path,
      status  : res.statusCode,
      duration,
      ip      : req.ip || req.connection?.remoteAddress,
      user    : req.user?.email || req.user?.id || null,
      ua      : req.get('user-agent') || null,
    });
  });
  next();
}

/**
 * Rediriger console.log/warn/error vers Winston (optionnel)
 * À appeler une seule fois au démarrage
 */
function redirectConsole() {
  const orig = {
    log  : console.log.bind(console),
    warn : console.warn.bind(console),
    error: console.error.bind(console),
    info : console.info.bind(console),
  };
  console.log   = (...args) => { logger.info(args.join(' '));  };
  console.info  = (...args) => { logger.info(args.join(' '));  };
  console.warn  = (...args) => { logger.warn(args.join(' '));  };
  console.error = (...args) => { logger.error(args.join(' ')); };
  return orig; // retourner les originaux si besoin de les restaurer
}

module.exports = {
  logger,
  actionLogger,
  logUserAction,
  logError,
  logWarn,
  httpLogger,
  redirectConsole,
  LOG_DIR,
};
