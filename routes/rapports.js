// routes/rapports.js — Liste et téléchargement des rapports PDF sauvegardés
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { requireAuth, requireRole } = require('../middleware/auth');

const RAPPORTS_DIR = '/app/rapports';

// GET /api/rapports — liste des rapports
router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    if (!fs.existsSync(RAPPORTS_DIR)) {
      return res.json({ success: true, rapports: [] });
    }
    const files = fs.readdirSync(RAPPORTS_DIR)
      .filter(f => f.endsWith('.pdf'))
      .map(f => {
        const stat = fs.statSync(path.join(RAPPORTS_DIR, f));
        return {
          nom      : f,
          taille   : stat.size,
          date     : stat.mtime,
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ success: true, rapports: files });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/rapports/:nom — télécharger un rapport
router.get('/:nom', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const nom  = req.params.nom.replace(/[^a-zA-Z0-9_\-\.]/g, '');
    const file = path.join(RAPPORTS_DIR, nom);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ success: false, error: 'Rapport introuvable' });
    }
    res.set({
      'Content-Type'        : 'application/pdf',
      'Content-Disposition' : `attachment; filename="${nom}"`,
    });
    fs.createReadStream(file).pipe(res);
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
