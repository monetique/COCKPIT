// schedulers/rapport-inscriptions.js
// Génère automatiquement le rapport inscriptions toutes les heures

const { execFileSync } = require('child_process');
const fs = require('fs');

async function genererRapport(app) {
  try {
    const client = require('../db/postgres');
    // Récupérer les stats via la route interne
    const axios = require('axios');
    const today = new Date().toLocaleDateString('fr-FR');

    const resp = await axios.post('http://localhost:3000/api/inscriptions/stats', {
      date_debut: '20/08/2026',
      date_fin  : today,
    }, {
      headers: { 'x-internal-scheduler': 'true' },
      timeout: 120000,
    });

    if (!resp.data?.success) {
      console.warn('[rapport-cron] Stats non disponibles');
      return;
    }

    const now       = new Date();
    const heureStr  = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const dateStr   = now.toLocaleDateString('fr-FR');
    const stats     = { ...resp.data, heure_rapport: heureStr, date_rapport: dateStr, generated: `${dateStr} a ${heureStr}` };
    const tmp       = `/tmp/rapport_auto_${Date.now()}.pdf`;

    execFileSync('python3', [
      '/app/scripts/gen_rapport_inscriptions.py',
      tmp,
      JSON.stringify(stats),
    ], { timeout: 120000 });

    if (fs.existsSync(tmp)) {
      const dest = `/app/rapports/Rapport_Inscriptions_${now.toISOString().slice(0,10)}_${heureStr.replace(':','h')}.pdf`;
      fs.mkdirSync('/app/rapports', { recursive: true });
      fs.copyFileSync(tmp, dest);
      fs.unlinkSync(tmp);
      console.log(`[rapport-cron] ✅ Rapport généré : ${dest}`);
    }
  } catch(e) {
    console.error('[rapport-cron] ❌', e.message);
  }
}

function start(app) {
  // Générer toutes les heures à HH:00
  const msUntilNextHour = () => {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next - now;
  };

  const scheduleNext = () => {
    setTimeout(async () => {
      await genererRapport(app);
      setInterval(() => genererRapport(app), 60 * 60 * 1000);
    }, msUntilNextHour());
  };

  scheduleNext();
  console.log('[rapport-cron] ✅ Démarré — rapport toutes les heures');
}

module.exports = { start };
