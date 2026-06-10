// routes/acs.js — Proxy vers l'API ACS 3DS2 (évite CORS)
const express = require('express');
const router  = express.Router();
const https   = require('https');
const http    = require('http');
const { requireAuth } = require('../middleware/auth');

const DEFAULT_ACS_URL = process.env.ACS_METRICS_URL || 'https://3ds2.clictopay.com/acs/metrics';

// ── GET /api/acs/metrics — proxy vers l'ACS ──────────────────
router.get('/metrics', requireAuth, async (req, res) => {
  const url = req.query.url || DEFAULT_ACS_URL;

  try {
    const data = await fetchUrl(url);
    // Parser si allorigins wrapper
    let json = data;
    if (json.contents && typeof json.contents === 'string') {
      json = JSON.parse(json.contents);
    }
    res.json({ success: true, data: json, source: url, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('ACS proxy error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/acs/test — tester l'accessibilité de l'URL ───────
router.get('/test', requireAuth, async (req, res) => {
  const url = req.query.url || DEFAULT_ACS_URL;
  try {
    await fetchUrl(url);
    res.json({ success: true, reachable: true, url });
  } catch (err) {
    res.json({ success: false, reachable: false, url, error: err.message });
  }
});

// ── Helper : fetch HTTP/HTTPS avec timeout ────────────────────
function fetchUrl(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'ClicToPay-Monitor/2.0' },
      timeout: timeoutMs,
    }, (response) => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`HTTP ${response.statusCode}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Réponse non-JSON reçue'));
        }
      });
    });
    req.on('error',   err => reject(err));
    req.on('timeout', ()  => { req.destroy(); reject(new Error('Timeout — ACS non joignable')); });
  });
}

module.exports = router;
