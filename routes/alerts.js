// routes/alerts.js — Gestion des règles d'alertes
const express     = require('express');
const router      = express.Router();
const { query }   = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail }= require('../config/mailer');
const { logAction}= require('../middleware/audit');

// ── GET /api/alerts — liste toutes les règles ─────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT r.*, u.email AS created_by_email
      FROM alert_rules r
      LEFT JOIN users u ON r.created_by = u.id
      ORDER BY r.systeme, r.created_at DESC`, []);
    res.json({ success: true, rules: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/alerts/history — historique déclenchements ───
router.get('/history', requireAuth, async (req, res) => {
  const { limit = 50, systeme } = req.query;
  try {
    let sql = `SELECT * FROM alert_history WHERE 1=1`;
    const params = [];
    if (systeme) { params.push(systeme); sql += ` AND systeme = $${params.length}`; }
    sql += ` ORDER BY triggered_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));
    const result = await query(sql, params);
    res.json({ success: true, history: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/alerts — créer une règle ────────────────────
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const {
    nom, systeme, metrique, operateur, seuil, unite,
    niveau, message, actif = true,
    notif_email = true, email_destinataires,
    refresh_interval_sec = 300, cooldown_sec = 3600
  } = req.body;

  if (!nom || !systeme || !metrique || !operateur || seuil == null || !message) {
    return res.status(400).json({ success: false, error: 'Champs obligatoires manquants' });
  }

  // Valider email_destinataires JSON
  let emailList = null;
  if (email_destinataires) {
    try {
      emailList = JSON.stringify(
        typeof email_destinataires === 'string'
          ? JSON.parse(email_destinataires)
          : email_destinataires
      );
    } catch {
      return res.status(400).json({ success: false, error: 'email_destinataires doit être un tableau JSON' });
    }
  }

  try {
    const result = await query(`
      INSERT INTO alert_rules
        (nom, systeme, metrique, operateur, seuil, unite, niveau, message,
         actif, notif_email, email_destinataires, refresh_interval_sec, cooldown_sec, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [nom, systeme, metrique, operateur, parseFloat(seuil), unite || '%',
       niveau || 'warning', message, actif, notif_email, emailList,
       parseInt(refresh_interval_sec), parseInt(cooldown_sec), req.user.id]
    );
    await logAction(req, 'CREATE_ALERT_RULE', `alert:${result.rows[0].id}`, { nom, systeme });
    res.json({ success: true, rule: result.rows[0] });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PATCH /api/alerts/:id — modifier une règle ────────────
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const {
    nom, systeme, metrique, operateur, seuil, unite,
    niveau, message, actif, notif_email, email_destinataires,
    refresh_interval_sec, cooldown_sec
  } = req.body;

  let emailList = undefined;
  if (email_destinataires !== undefined) {
    try {
      emailList = JSON.stringify(
        typeof email_destinataires === 'string'
          ? JSON.parse(email_destinataires)
          : email_destinataires
      );
    } catch {
      return res.status(400).json({ success: false, error: 'email_destinataires invalide' });
    }
  }

  try {
    const result = await query(`
      UPDATE alert_rules SET
        nom                  = COALESCE($1,  nom),
        systeme              = COALESCE($2,  systeme),
        metrique             = COALESCE($3,  metrique),
        operateur            = COALESCE($4,  operateur),
        seuil                = COALESCE($5,  seuil),
        unite                = COALESCE($6,  unite),
        niveau               = COALESCE($7,  niveau),
        message              = COALESCE($8,  message),
        actif                = COALESCE($9,  actif),
        notif_email          = COALESCE($10, notif_email),
        email_destinataires  = COALESCE($11, email_destinataires),
        refresh_interval_sec = COALESCE($12, refresh_interval_sec),
        cooldown_sec         = COALESCE($13, cooldown_sec),
        updated_at           = NOW()
      WHERE id = $14
      RETURNING *`,
      [nom, systeme, metrique, operateur,
       seuil != null ? parseFloat(seuil) : null,
       unite, niveau, message, actif, notif_email,
       emailList, refresh_interval_sec ? parseInt(refresh_interval_sec) : null,
       cooldown_sec ? parseInt(cooldown_sec) : null,
       req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Règle introuvable' });
    await logAction(req, 'UPDATE_ALERT_RULE', `alert:${req.params.id}`);
    res.json({ success: true, rule: result.rows[0] });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/alerts/:id — supprimer une règle ──────────
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM alert_rules WHERE id = $1', [req.params.id]);
    await logAction(req, 'DELETE_ALERT_RULE', `alert:${req.params.id}`);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/alerts/:id/test — tester l'envoi email ─────
router.post('/:id/test', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await query('SELECT * FROM alert_rules WHERE id = $1', [req.params.id]);
    const rule = result.rows[0];
    if (!rule) return res.status(404).json({ success: false, error: 'Règle introuvable' });

    const emails = rule.email_destinataires ? JSON.parse(rule.email_destinataires) : [];
    if (!emails.length) return res.status(400).json({ success: false, error: 'Aucun destinataire configuré' });

    await sendMail({
      to     : emails.join(', '),
      subject: `[SMT COCKPIT TEST] Alerte — ${rule.nom}`,
      html   : buildAlertEmail(rule, rule.seuil, true),
    });

    res.json({ success: true, sent_to: emails });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/alerts/trigger — déclencher manuellement ────
// Appelé par le moteur d'évaluation (cron ou dashboard)
router.post('/trigger', requireAuth, async (req, res) => {
  const { rule_id, valeur } = req.body;
  if (!rule_id || valeur == null) {
    return res.status(400).json({ success: false, error: 'rule_id et valeur requis' });
  }
  try {
    const ruleRes = await query('SELECT * FROM alert_rules WHERE id = $1 AND actif = true', [rule_id]);
    const rule = ruleRes.rows[0];
    if (!rule) return res.status(404).json({ success: false, error: 'Règle introuvable ou inactive' });

    // Vérifier cooldown
    if (rule.derniere_notif) {
      const elapsed = (Date.now() - new Date(rule.derniere_notif).getTime()) / 1000;
      if (elapsed < rule.cooldown_sec) {
        return res.json({ success: true, triggered: false, reason: `Cooldown actif (${Math.round(rule.cooldown_sec - elapsed)}s restants)` });
      }
    }

    // Évaluer la condition
    const triggered = evalCondition(parseFloat(valeur), rule.operateur, parseFloat(rule.seuil));
    if (!triggered) return res.json({ success: true, triggered: false });

    // Enregistrer dans l'historique
    const emails = rule.email_destinataires ? JSON.parse(rule.email_destinataires) : [];
    let emailEnvoye = false;

    if (rule.notif_email && emails.length) {
      try {
        await sendMail({
          to     : emails.join(', '),
          subject: `[SMT COCKPIT 🚨] ${rule.niveau === 'danger' ? '🔴' : '🟠'} Alerte — ${rule.nom}`,
          html   : buildAlertEmail(rule, valeur, false),
        });
        emailEnvoye = true;
      } catch(mailErr) {
        console.error('Erreur envoi email alerte:', mailErr.message);
      }
    }

    await query(`
      INSERT INTO alert_history (rule_id, rule_nom, systeme, niveau, message, valeur, seuil, email_envoye, email_destinataires)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [rule.id, rule.nom, rule.systeme, rule.niveau,
       rule.message, parseFloat(valeur), parseFloat(rule.seuil),
       emailEnvoye, rule.email_destinataires]
    );

    await query(`UPDATE alert_rules SET derniere_notif = NOW(), derniere_valeur = $1 WHERE id = $2`,
      [parseFloat(valeur), rule.id]);

    res.json({ success: true, triggered: true, email_envoye: emailEnvoye, sent_to: emails });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Helpers ───────────────────────────────────────────────
function evalCondition(valeur, operateur, seuil) {
  switch(operateur.trim()) {
    case '>':  return valeur >  seuil;
    case '>=': return valeur >= seuil;
    case '<':  return valeur <  seuil;
    case '<=': return valeur <= seuil;
    case '=':  return valeur === seuil;
    default:   return false;
  }
}

function buildAlertEmail(rule, valeur, isTest) {
  const color  = rule.niveau === 'danger' ? '#dc2626' : rule.niveau === 'warning' ? '#f59e0b' : '#3b82f6';
  const icon   = rule.niveau === 'danger' ? '🔴' : rule.niveau === 'warning' ? '🟠' : 'ℹ️';
  const system = { clictopay:'CLICTOPAY BPC', acs:'ACS 3DS2', paysmart:'PAYSMART SwitchBI' }[rule.systeme] || rule.systeme;
  const now    = new Date().toLocaleString('fr-FR');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px">
<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#0f2444;padding:18px 28px;display:flex;align-items:center;gap:12px">
    <div style="color:#fff;font-size:15px;font-weight:700">SMT COCKPIT — Alerte ${isTest ? '(TEST)' : ''}</div>
  </div>
  <div style="padding:24px 28px">
    <div style="background:${color}18;border-left:4px solid ${color};border-radius:4px;padding:14px 18px;margin-bottom:20px">
      <div style="font-size:16px;font-weight:700;color:${color}">${icon} ${rule.nom}</div>
      <div style="font-size:13px;color:#334155;margin-top:6px">${rule.message}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b;font-weight:600;width:40%">Système</td><td style="padding:8px 12px;color:#1e293b">${system}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;font-weight:600">Valeur mesurée</td><td style="padding:8px 12px;color:${color};font-weight:700;font-size:15px">${parseFloat(valeur).toFixed(2)} ${rule.unite}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b;font-weight:600">Seuil configuré</td><td style="padding:8px 12px;color:#1e293b">${rule.operateur} ${rule.seuil} ${rule.unite}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;font-weight:600">Niveau</td><td style="padding:8px 12px"><span style="background:${color}18;color:${color};padding:2px 8px;border-radius:4px;font-weight:600;font-size:12px">${rule.niveau.toUpperCase()}</span></td></tr>
      <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b;font-weight:600">Date/Heure</td><td style="padding:8px 12px;color:#1e293b;font-family:monospace">${now}</td></tr>
    </table>
    <div style="margin-top:20px;padding:12px 16px;background:#fff7ed;border-radius:6px;font-size:12px;color:#92400e">
      ⚡ Connectez-vous au tableau de bord SMT COCKPIT pour plus de détails.
    </div>
  </div>
  <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 28px;text-align:center;font-size:11px;color:#94a3b8">
    SMT COCKPIT · Monetique Tunisie · Alerte automatique
  </div>
</div>
</body></html>`;
}

module.exports = router;
