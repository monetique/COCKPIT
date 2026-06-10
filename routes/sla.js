// routes/sla.js — Gestion SLA et alertes de stagnation dossiers marchands
'use strict';
const express   = require('express');
const router    = express.Router();
const { query } = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail, getCcList }      = require('../config/mailer');
const { logAction }                = require('../middleware/audit');

// ── GET /api/sla/config — lire la config SLA ─────────────
router.get('/config', requireAuth, async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM sla_config ORDER BY
        CASE statut
          WHEN 'en_attente'        THEN 1
          WHEN 'prise_en_charge'   THEN 2
          WHEN 'recettes_envoyees' THEN 3
          WHEN 'recettes_recues'   THEN 4
          WHEN 'valide'            THEN 5
          WHEN 'banque_notifiee'   THEN 6
          ELSE 7
        END`, []
    );
    res.json({ success: true, config: r.rows });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── PATCH /api/sla/config/:statut — modifier les délais ──
router.patch('/config/:statut', requireAuth, requireRole('admin'), async (req, res) => {
  const { delai_warning, delai_danger, actif } = req.body;
  try {
    const r = await query(`
      UPDATE sla_config SET
        delai_warning = COALESCE($1, delai_warning),
        delai_danger  = COALESCE($2, delai_danger),
        actif         = COALESCE($3, actif),
        updated_at    = NOW()
      WHERE statut = $4
      RETURNING *`,
      [delai_warning ?? null, delai_danger ?? null, actif ?? null, req.params.statut]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: 'Statut SLA introuvable' });
    await logAction(req, 'UPDATE_SLA_CONFIG', `sla:${req.params.statut}`, { delai_warning, delai_danger });
    res.json({ success: true, config: r.rows[0] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/sla/dossiers — dossiers en retard ────────────
// Retourne tous les dossiers dont le délai SLA est dépassé
router.get('/dossiers', requireAuth, async (req, res) => {
  const { niveau, statut, limit = 100 } = req.query;
  try {
    // Jointure avec sla_config pour calculer le retard
    let sql = `
      SELECT
        mt.processing_id,
        mt.raison_sociale,
        mt.statut,
        mt.email_contact,
        mt.date_import,
        mt.date_prise_en_charge,
        mt.date_envoi_recettes,
        mt.date_reception_recettes,
        mt.date_validation,
        mt.date_notif_banque,
        mt.sla_derniere_alerte,
        sc.delai_warning,
        sc.delai_danger,
        -- Date depuis laquelle le dossier est dans l'étape courante
        CASE mt.statut
          WHEN 'en_attente'        THEN mt.date_import
          WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
          WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
          WHEN 'recettes_recues'   THEN mt.date_reception_recettes
          WHEN 'valide'            THEN mt.date_validation
          WHEN 'banque_notifiee'   THEN mt.date_notif_banque
          ELSE mt.date_import
        END AS date_etape_debut,
        EXTRACT(DAY FROM (NOW() - CASE mt.statut
          WHEN 'en_attente'        THEN mt.date_import
          WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
          WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
          WHEN 'recettes_recues'   THEN mt.date_reception_recettes
          WHEN 'valide'            THEN mt.date_validation
          WHEN 'banque_notifiee'   THEN mt.date_notif_banque
          ELSE mt.date_import
        END))::INT AS jours_etape,
        CASE
          WHEN EXTRACT(DAY FROM (NOW() - CASE mt.statut
            WHEN 'en_attente'        THEN mt.date_import
            WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
            WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
            WHEN 'recettes_recues'   THEN mt.date_reception_recettes
            WHEN 'valide'            THEN mt.date_validation
            WHEN 'banque_notifiee'   THEN mt.date_notif_banque
            ELSE mt.date_import
          END)) >= sc.delai_danger  THEN 'danger'
          WHEN EXTRACT(DAY FROM (NOW() - CASE mt.statut
            WHEN 'en_attente'        THEN mt.date_import
            WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
            WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
            WHEN 'recettes_recues'   THEN mt.date_reception_recettes
            WHEN 'valide'            THEN mt.date_validation
            WHEN 'banque_notifiee'   THEN mt.date_notif_banque
            ELSE mt.date_import
          END)) >= sc.delai_warning THEN 'warning'
          ELSE 'ok'
        END AS niveau_sla
      FROM merchants_tracking mt
      JOIN sla_config sc ON sc.statut = mt.statut AND sc.actif = true
      WHERE mt.statut NOT IN ('en_production')
        AND CASE mt.statut
          WHEN 'en_attente'        THEN mt.date_import
          WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
          WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
          WHEN 'recettes_recues'   THEN mt.date_reception_recettes
          WHEN 'valide'            THEN mt.date_validation
          WHEN 'banque_notifiee'   THEN mt.date_notif_banque
          ELSE mt.date_import
        END IS NOT NULL`;

    const params = [];

    if (niveau && niveau !== 'all') {
      params.push(niveau);
      sql += ` AND (
        CASE
          WHEN EXTRACT(DAY FROM (NOW() - CASE mt.statut
            WHEN 'en_attente'        THEN mt.date_import
            WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
            WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
            WHEN 'recettes_recues'   THEN mt.date_reception_recettes
            WHEN 'valide'            THEN mt.date_validation
            WHEN 'banque_notifiee'   THEN mt.date_notif_banque
            ELSE mt.date_import
          END)) >= sc.delai_danger  THEN 'danger'
          WHEN EXTRACT(DAY FROM (NOW() - CASE mt.statut
            WHEN 'en_attente'        THEN mt.date_import
            WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
            WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
            WHEN 'recettes_recues'   THEN mt.date_reception_recettes
            WHEN 'valide'            THEN mt.date_validation
            WHEN 'banque_notifiee'   THEN mt.date_notif_banque
            ELSE mt.date_import
          END)) >= sc.delai_warning THEN 'warning'
          ELSE 'ok'
        END
      ) = $${params.length}`;
    } else {
      // Par défaut : seulement les dossiers en retard (warning ou danger)
      sql += ` AND EXTRACT(DAY FROM (NOW() - CASE mt.statut
        WHEN 'en_attente'        THEN mt.date_import
        WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
        WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
        WHEN 'recettes_recues'   THEN mt.date_reception_recettes
        WHEN 'valide'            THEN mt.date_validation
        WHEN 'banque_notifiee'   THEN mt.date_notif_banque
        ELSE mt.date_import
      END)) >= sc.delai_warning`;
    }

    if (statut && statut !== 'all') {
      params.push(statut);
      sql += ` AND mt.statut = $${params.length}`;
    }

    sql += ` ORDER BY jours_etape DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await query(sql, params);
    // Résumé par niveau
    const summary = { danger: 0, warning: 0, total: result.rows.length };
    result.rows.forEach(r => { if (r.niveau_sla === 'danger') summary.danger++; else if (r.niveau_sla === 'warning') summary.warning++; });
    res.json({ success: true, dossiers: result.rows, summary });
  } catch(e) {
    console.error('[sla/dossiers]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/sla/history — historique alertes envoyées ───
router.get('/history', requireAuth, async (req, res) => {
  const { limit = 50 } = req.query;
  try {
    const r = await query(
      `SELECT * FROM sla_alerts ORDER BY triggered_at DESC LIMIT $1`,
      [parseInt(limit)]
    );
    res.json({ success: true, history: r.rows });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/sla/check — scanner et alerter ─────────────
// Peut être appelé manuellement ou par le scheduler
// Cooldown par dossier : 24h entre deux alertes pour le même dossier
router.post('/check', requireAuth, async (req, res) => {
  const { dry_run = false, email_override } = req.body;
  const result = await runSlaCheck({ dry_run, email_override, triggeredBy: req.user?.email });
  res.json(result);
});

// ── Fonction principale de vérification SLA ───────────────
async function runSlaCheck({ dry_run = false, email_override, triggeredBy = 'scheduler' } = {}) {
  const now = new Date();
  const COOLDOWN_H = 24; // heures entre 2 alertes pour le même dossier

  try {
    // Charger les dossiers en retard (warning + danger)
    const dossiersRes = await query(`
      SELECT
        mt.processing_id, mt.raison_sociale, mt.statut,
        mt.email_contact, mt.sla_derniere_alerte,
        sc.delai_warning, sc.delai_danger,
        EXTRACT(DAY FROM (NOW() - CASE mt.statut
          WHEN 'en_attente'        THEN mt.date_import
          WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
          WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
          WHEN 'recettes_recues'   THEN mt.date_reception_recettes
          WHEN 'valide'            THEN mt.date_validation
          WHEN 'banque_notifiee'   THEN mt.date_notif_banque
          ELSE mt.date_import
        END))::INT AS jours_etape
      FROM merchants_tracking mt
      JOIN sla_config sc ON sc.statut = mt.statut AND sc.actif = true
      WHERE mt.statut NOT IN ('en_production')
        AND EXTRACT(DAY FROM (NOW() - CASE mt.statut
          WHEN 'en_attente'        THEN mt.date_import
          WHEN 'prise_en_charge'   THEN mt.date_prise_en_charge
          WHEN 'recettes_envoyees' THEN mt.date_envoi_recettes
          WHEN 'recettes_recues'   THEN mt.date_reception_recettes
          WHEN 'valide'            THEN mt.date_validation
          WHEN 'banque_notifiee'   THEN mt.date_notif_banque
          ELSE mt.date_import
        END)) >= sc.delai_warning
      ORDER BY jours_etape DESC`, []);

    const dossiers = dossiersRes.rows;
    let alertsSent = 0, alertsSkipped = 0, errors = 0;
    const details  = [];

    for (const d of dossiers) {
      // Vérifier cooldown : ne pas ré-alerter avant 24h
      if (d.sla_derniere_alerte) {
        const heures = (now - new Date(d.sla_derniere_alerte)) / 3_600_000;
        if (heures < COOLDOWN_H) {
          alertsSkipped++;
          continue;
        }
      }

      const niveau = d.jours_etape >= d.delai_danger ? 'danger' : 'warning';
      const emails = email_override
        ? [email_override]
        : [...getCcList()].filter(Boolean);

      if (!dry_run && emails.length > 0) {
        try {
          await sendMail({
            to     : emails.join(', '),
            subject: `[SMT COCKPIT ${niveau === 'danger' ? '🔴' : '🟠'}] Dossier en retard — ${d.raison_sociale} (${d.jours_etape}j)`,
            html   : buildSlaEmail(d, niveau),
          });

          // Enregistrer l'alerte
          await query(`
            INSERT INTO sla_alerts
              (processing_id, raison_sociale, statut, jours_en_attente, niveau, email_envoye, email_destinataires)
            VALUES ($1,$2,$3,$4,$5,true,$6)`,
            [d.processing_id, d.raison_sociale, d.statut,
             d.jours_etape, niveau, JSON.stringify(emails)]
          );

          // Mettre à jour le cooldown
          await query(
            `UPDATE merchants_tracking SET sla_derniere_alerte = NOW() WHERE processing_id = $1`,
            [d.processing_id]
          );

          alertsSent++;
          details.push({ pid: d.processing_id, nom: d.raison_sociale, statut: d.statut, jours: d.jours_etape, niveau, action: 'sent' });
        } catch(mailErr) {
          console.error(`[sla] Erreur email ${d.processing_id}:`, mailErr.message);
          errors++;
        }
      } else {
        // Dry run ou pas d'email configuré
        details.push({ pid: d.processing_id, nom: d.raison_sociale, statut: d.statut, jours: d.jours_etape, niveau, action: dry_run ? 'dry_run' : 'no_recipient' });
        if (!dry_run) alertsSkipped++;
      }
    }

    const summary = {
      success      : true,
      total_late   : dossiers.length,
      alerts_sent  : alertsSent,
      alerts_skipped: alertsSkipped,
      errors,
      dry_run,
      triggered_by : triggeredBy,
      checked_at   : now.toISOString(),
      details,
    };

    if (!dry_run && alertsSent > 0) {
      console.log(`[SLA] Check terminé : ${alertsSent} alertes envoyées | ${alertsSkipped} ignorées (cooldown) | ${dossiers.length} en retard`);
    }

    return summary;
  } catch(e) {
    console.error('[SLA] Erreur runSlaCheck:', e.message);
    return { success: false, error: e.message };
  }
}

// ── Builder email SLA ─────────────────────────────────────
function buildSlaEmail(d, niveau) {
  const color = niveau === 'danger' ? '#dc2626' : '#f59e0b';
  const icon  = niveau === 'danger' ? '🔴' : '🟠';
  const label = {
    en_attente        : 'En attente de traitement',
    prise_en_charge   : 'Prise en charge (email envoyé)',
    recettes_envoyees : 'Cahier de recettes envoyé',
    recettes_recues   : 'Recettes reçues — en attente validation',
    valide            : 'Validé — notification banque en attente',
    banque_notifiee   : 'Banque notifiée — production en attente',
  }[d.statut] || d.statut;

  const now = new Date().toLocaleString('fr-FR');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#0f2444;padding:18px 28px">
    <div style="color:#fff;font-size:15px;font-weight:700">SMT COCKPIT — Alerte SLA ${icon}</div>
    <div style="color:#93c5fd;font-size:11px;margin-top:4px">Dossier marchand en retard de traitement</div>
  </div>
  <div style="padding:24px 28px">
    <div style="background:${color}18;border-left:4px solid ${color};border-radius:4px;padding:14px 18px;margin-bottom:20px">
      <div style="font-size:16px;font-weight:700;color:${color}">${icon} Dossier bloqué depuis ${d.jours_etape} jours</div>
      <div style="font-size:13px;color:#334155;margin-top:4px">${d.raison_sociale} — ${d.processing_id}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;color:#64748b;font-weight:600;width:45%">Marchand</td>
        <td style="padding:8px 12px;color:#1e293b;font-weight:700">${d.raison_sociale}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#64748b;font-weight:600">Processing ID</td>
        <td style="padding:8px 12px;font-family:monospace;color:#1d4ed8">${d.processing_id}</td>
      </tr>
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;color:#64748b;font-weight:600">Étape actuelle</td>
        <td style="padding:8px 12px;color:#1e293b">${label}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#64748b;font-weight:600">Durée dans cette étape</td>
        <td style="padding:8px 12px;color:${color};font-weight:700;font-size:15px">${d.jours_etape} jour(s)</td>
      </tr>
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;color:#64748b;font-weight:600">Niveau alerte</td>
        <td style="padding:8px 12px">
          <span style="background:${color}18;color:${color};padding:2px 10px;border-radius:20px;font-weight:600;font-size:11px">
            ${niveau.toUpperCase()}
          </span>
        </td>
      </tr>
      ${d.email_contact ? `<tr>
        <td style="padding:8px 12px;color:#64748b;font-weight:600">Email marchand</td>
        <td style="padding:8px 12px;color:#1e293b">${d.email_contact}</td>
      </tr>` : ''}
    </table>
    <div style="background:#fff7ed;border-radius:6px;padding:12px 16px;font-size:12px;color:#92400e">
      ⚡ Connectez-vous au tableau de bord SMT COCKPIT → Module Marchands pour traiter ce dossier.
    </div>
    <div style="font-size:11px;color:#94a3b8;margin-top:12px;text-align:center">${now}</div>
  </div>
  <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:10px 28px;text-align:center;font-size:11px;color:#94a3b8">
    SMT COCKPIT · Monetique Tunisie · Alerte SLA automatique
  </div>
</div>
</body></html>`;
}

module.exports = router;
module.exports.runSlaCheck = runSlaCheck;
