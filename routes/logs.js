// routes/logs.js — Consultation des logs depuis l'interface (admin)
'use strict';

const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { requireAuth, requireRole } = require('../middleware/auth');
const { LOG_DIR } = require('../config/logger');

// ── GET /api/logs/files — liste les fichiers disponibles ──
router.get('/files', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log') || f.endsWith('.log.gz'))
      .map(f => {
        const stat = fs.statSync(path.join(LOG_DIR, f));
        return {
          name    : f,
          size    : stat.size,
          sizeKB  : Math.round(stat.size / 1024),
          modified: stat.mtime,
          type    : f.includes('errors') ? 'error'
                  : f.includes('actions') ? 'action'
                  : f.includes('http')    ? 'http'
                  : 'all',
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ success: true, files, logDir: LOG_DIR });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/logs — lecture des logs avec filtres ─────────
// ?type=all|error|action|http
// ?level=error|warn|info|http|debug
// ?user=email
// ?action=LOGIN
// ?from=2026-04-01&to=2026-04-15
// ?limit=100
// ?q=texte_libre
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const {
    type   = 'all',
    level,
    user,
    action,
    from,
    to,
    limit  = 500,
    q,
  } = req.query;

  try {
    // Choisir les fichiers selon le type
    const prefix = type === 'error'  ? 'smt-cockpit-errors'
                 : type === 'action' ? 'smt-cockpit-actions'
                 : type === 'http'   ? 'smt-cockpit-http'
                 : 'smt-cockpit';

    // Trouver tous les fichiers .log du type (pas .gz)
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith('.log'))
      .sort()
      .reverse()  // plus récents en premier
      .slice(0, 7); // derniers 7 jours max

    const entries = [];
    const fromDate = from ? new Date(from) : null;
    const toDate   = to   ? new Date(to + 'T23:59:59') : null;
    const lim      = parseInt(limit) || 500;

    for (const file of files) {
      if (entries.length >= lim) break;
      const filePath = path.join(LOG_DIR, file);
      const lines    = await readLastLines(filePath, lim * 2);

      for (const line of lines.reverse()) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          // Filtres
          if (level  && entry.level  !== level)                    continue;
          if (user   && entry.user   !== user)                     continue;
          if (action && entry.action !== action)                   continue;
          if (fromDate && new Date(entry.timestamp) < fromDate)    continue;
          if (toDate   && new Date(entry.timestamp) > toDate)      continue;
          if (q && !JSON.stringify(entry).toLowerCase().includes(q.toLowerCase())) continue;

          entries.push(entry);
          if (entries.length >= lim) break;
        } catch {}
      }
    }

    res.json({ success: true, entries, total: entries.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/logs/stats — statistiques rapides ────────────
router.get('/stats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const today  = new Date().toISOString().slice(0, 10);
    const todayFile = path.join(LOG_DIR, `smt-cockpit-${today}.log`);
    const errFile   = path.join(LOG_DIR, `smt-cockpit-errors-${today}.log`);

    let todayTotal = 0, todayErrors = 0, todayWarns = 0,
        todayActions = 0, topActions = {}, topUsers = {};

    if (fs.existsSync(todayFile)) {
      const lines = await readLastLines(todayFile, 5000);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          todayTotal++;
          if (e.level === 'error') todayErrors++;
          if (e.level === 'warn')  todayWarns++;
          if (e.action && e.type !== 'http') {
            todayActions++;
            topActions[e.action] = (topActions[e.action] || 0) + 1;
            if (e.user) topUsers[e.user] = (topUsers[e.user] || 0) + 1;
          }
        } catch {}
      }
    }

    // Top 5 actions
    const topActionsArr = Object.entries(topActions)
      .sort(([,a],[,b]) => b - a).slice(0, 5)
      .map(([action, count]) => ({ action, count }));

    // Top 5 users
    const topUsersArr = Object.entries(topUsers)
      .sort(([,a],[,b]) => b - a).slice(0, 5)
      .map(([user, count]) => ({ user, count }));

    res.json({
      success: true,
      today: {
        total  : todayTotal,
        errors : todayErrors,
        warns  : todayWarns,
        actions: todayActions,
      },
      topActions: topActionsArr,
      topUsers  : topUsersArr,
      logDir    : LOG_DIR,
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Helper : lire les N dernières lignes d'un fichier ──────
function readLastLines(filePath, n) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve([]);
    const lines = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => { lines.push(line); if (lines.length > n) lines.shift(); });
    rl.on('close', () => resolve(lines));
    rl.on('error', () => resolve(lines));
  });
}

module.exports = router;
