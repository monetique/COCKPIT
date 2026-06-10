// routes/banques-dashboard.js
// Tableau de bord par banque — données agrégées
'use strict';
const express  = require('express');
const router   = express.Router();
const { query } = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { bankFilter } = require('../middleware/banquier');

// ── GET /api/banques-dashboard/stats ─────────────────────
// Vue d'ensemble toutes banques (admin/supervisor) ou banque spécifique (banquier)
router.get('/stats', requireAuth, bankFilter, async (req, res) => {
  try {
    const isB   = req.bankFilter?.isBanquier;
    const code  = req.bankFilter?.code;
    const whereClause = isB ? `WHERE SUBSTRING(processing_id, 1, 2) = '${code}'` : '';
    const andClause  = isB ? `AND SUBSTRING(processing_id, 1, 2) = '${code}'` : '';

    // Stats par statut
    const byStatut = await query(`
      SELECT statut, COUNT(*) AS total
      FROM merchants_tracking ${whereClause}
      GROUP BY statut ORDER BY statut
    `);

    // Stats par banque (pour admin — répartition complète)
    const byBanque = isB ? null : await query(`
      SELECT
        SUBSTRING(mt.processing_id, 1, 2)  AS code,
        COALESCE(b.name, 'Banque inconnue') AS banque,
        COUNT(*)                            AS total,
        COUNT(*) FILTER (WHERE mt.statut = 'en_production') AS en_prod,
        COUNT(*) FILTER (WHERE mt.statut = 'recettes_envoyees') AS en_cours,
        COUNT(*) FILTER (WHERE mt.oracle_prod = true) AS oracle_prod
      FROM merchants_tracking mt
      LEFT JOIN banks b ON LPAD(b.code::text, 2, '0') = SUBSTRING(mt.processing_id, 1, 2) AND b.actif = true
      GROUP BY SUBSTRING(mt.processing_id, 1, 2), b.name
      ORDER BY total DESC
    `);

    // Évolution mensuelle créations + mise en production (12 derniers mois)
    const evolution = await query(`
      SELECT
        TO_CHAR(date_import, 'YYYY-MM')                                     AS mois,
        COUNT(*)                                                             AS creations,
        COUNT(*) FILTER (WHERE date_production IS NOT NULL)                  AS productions
      FROM merchants_tracking
      WHERE date_import >= NOW() - INTERVAL '12 months' ${andClause}
      GROUP BY TO_CHAR(date_import, 'YYYY-MM')
      ORDER BY mois ASC
    `);

    // UAT par statut
    const uat = await query(`
      SELECT uat_status, COUNT(*) AS total
      FROM merchants_tracking ${whereClause}
      GROUP BY uat_status ORDER BY total DESC
    `);

    // Totaux globaux
    const totaux = await query(`
      SELECT
        COUNT(*)                                                              AS total,
        COUNT(*) FILTER (WHERE statut = 'en_production')                     AS en_production,
        COUNT(*) FILTER (WHERE statut = 'recettes_envoyees')                 AS recettes_envoyees,
        COUNT(*) FILTER (WHERE statut = 'valide')                            AS valides,
        COUNT(*) FILTER (WHERE statut = 'en_attente')                        AS en_attente,
        COUNT(*) FILTER (WHERE oracle_prod = true)                           AS oracle_prod,
        COUNT(*) FILTER (WHERE uat_status = 'provisionne')                   AS uat_ok
      FROM merchants_tracking ${whereClause}
    `);

    res.json({
      success   : true,
      banque    : isB ? { code, isBanquier: true } : { code: null, isBanquier: false },
      totaux    : totaux.rows[0],
      byStatut  : byStatut.rows,
      byBanque  : byBanque?.rows || null,
      evolution : evolution.rows,
      uat       : uat.rows,
    });
  } catch(e) {
    console.error('[banques-dashboard]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/banques-dashboard/list ──────────────────────
// Liste des banques avec leurs stats (admin uniquement)
router.get('/list', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const result = await query(`
      SELECT
        LPAD(b.code::text, 2, '0')                                         AS code,
        b.name                                                             AS banque,
        b.email,
        b.email_cc,
        COUNT(mt.processing_id)                                            AS total_marchands,
        COUNT(mt.processing_id) FILTER (WHERE mt.statut = 'en_production') AS en_production,
        COUNT(mt.processing_id) FILTER (WHERE mt.statut = 'en_attente')    AS en_attente,
        COUNT(mt.processing_id) FILTER (WHERE mt.statut = 'recettes_envoyees') AS en_cours,
        COUNT(mt.processing_id) FILTER (WHERE mt.oracle_prod = true)        AS oracle_prod,
        COUNT(mt.processing_id) FILTER (WHERE mt.uat_status = 'provisionne') AS uat_ok
      FROM banks b
      LEFT JOIN merchants_tracking mt
        ON LPAD(b.code::text, 2, '0') = SUBSTRING(mt.processing_id, 1, 2)
      WHERE b.actif = true
      GROUP BY b.code, b.name, b.email, b.email_cc
      ORDER BY total_marchands DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
