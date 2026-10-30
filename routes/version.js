// routes/version.js — Gestion des versions de SMT Cockpit
'use strict';
const express   = require('express');
const router    = express.Router();
const os        = require('os');
const { query } = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── Enregistrement automatique au démarrage ──────────────────
// Appelé depuis server-v2.js au boot
async function registerVersion() {
  try {
    const pkg       = require('../package.json');
    const version   = pkg.version || '0.0.0';
    const changelog = pkg.changelog || null;
    const hostname  = process.env.HOSTNAME || os.hostname();
    const gitCommit = process.env.GIT_COMMIT || null;

    // Vérifier si cette version est déjà active
    const existing = await query(
      `SELECT id FROM app_versions WHERE version=$1 AND actif=true`, [version]
    );
    if (existing.rows.length) {
      console.log(`[version] ✅ v${version} déjà enregistrée`);
      return;
    }

    // Désactiver l'ancienne version active
    await query(`UPDATE app_versions SET actif=false WHERE actif=true`, []);

    // Enregistrer la nouvelle
    await query(
      `INSERT INTO app_versions (version, changelog, deployed_by, git_commit, actif)
       VALUES ($1, $2, $3, $4, true)`,
      [version, changelog, hostname, gitCommit]
    );
    console.log(`[version] 🚀 SMT Cockpit v${version} enregistrée (${hostname})`);
  } catch(e) {
    console.warn('[version] Enregistrement échoué:', e.message);
  }
}

// ── GET /api/version/current — version courante (public) ─────
router.get('/current', async (req, res) => {
  try {
    const r = await query(
      `SELECT version, changelog, deployed_at, deployed_by
       FROM app_versions WHERE actif=true ORDER BY deployed_at DESC LIMIT 1`, []
    );
    const pkg = require('../package.json');
    res.json({
      success    : true,
      version    : r.rows[0]?.version || pkg.version,
      changelog  : r.rows[0]?.changelog || null,
      deployedAt : r.rows[0]?.deployed_at || null,
      deployedBy : r.rows[0]?.deployed_by || null,
    });
  } catch(e) {
    const pkg = require('../package.json');
    res.json({ success:true, version: pkg.version, changelog:null });
  }
});

// ── GET /api/version — historique complet (admin) ────────────
router.get('/', requireAuth, requireRole('admin','directeur','pilotage'), async (req, res) => {
  try {
    const r = await query(
      `SELECT id, version, changelog, deployed_at, deployed_by, git_commit, actif
       FROM app_versions ORDER BY deployed_at DESC`, []
    );
    res.json({ success:true, versions: r.rows });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── POST /api/version — ajouter une version manuellement ─────
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { version, changelog } = req.body;
  if (!version) return res.status(400).json({ success:false, error:'version requis' });
  try {
    // Désactiver l'ancienne
    await query(`UPDATE app_versions SET actif=false WHERE actif=true`, []);
    const hostname = process.env.HOSTNAME || os.hostname();
    const r = await query(
      `INSERT INTO app_versions (version, changelog, deployed_by, actif)
       VALUES ($1,$2,$3,true) RETURNING *`,
      [version, changelog||null, hostname]
    );
    res.json({ success:true, version: r.rows[0] });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── PATCH /api/version/:id/changelog — éditer le changelog ──
router.patch('/:id/changelog', requireAuth, requireRole('admin'), async (req, res) => {
  const { changelog } = req.body;
  try {
    await query(
      `UPDATE app_versions SET changelog=$1 WHERE id=$2`, [changelog, req.params.id]
    );
    res.json({ success:true });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

module.exports = { router, registerVersion };
