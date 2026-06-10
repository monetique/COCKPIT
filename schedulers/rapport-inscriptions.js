// schedulers/rapport-inscriptions.js
// Génère et envoie le rapport inscriptions scolaires toutes les heures

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

async function genererEtEnvoyerRapport(app) {
  const now    = new Date();
  // Tunisie = UTC+1
  const nowTN  = new Date(now.getTime() + 60*60*1000);
  const heure  = nowTN.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const date   = nowTN.toLocaleDateString('fr-FR');

  console.log(`[rapport-cron] ⏰ Démarrage génération ${date} ${heure}`);

  try {
    // ── 1. Récupérer les stats via appel interne ────────
    const http = require('http');
    const today = nowTN.toLocaleDateString('fr-FR');

    // Générer un token JWT interne valide
    const { generateAccessToken } = require('../middleware/auth');
    const internalToken = generateAccessToken({
      id: 'scheduler', role: 'admin', email: 'scheduler@internal',
      nom: 'Scheduler', prenom: 'Auto',
    });

    const stats = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ date_debut: '20/08/2026', date_fin: today });
      const req  = http.request({
        hostname: 'localhost',
        port    : 3000,
        path    : '/api/inscriptions/stats',
        method  : 'POST',
        headers : {
          'Content-Type'   : 'application/json',
          'Content-Length' : Buffer.byteLength(body),
          'Authorization'  : 'Bearer ' + internalToken,
        }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('Parse error: ' + data.slice(0,200))); }
        });
      });
      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout stats')); });
      req.write(body);
      req.end();
    });

    if (!stats?.success) {
      console.warn('[rapport-cron] Stats non disponibles:', stats?.error);
      return;
    }

    // ── 2. Générer le PDF ───────────────────────────────
    const statsEnriched = { ...stats, heure_rapport: heure, date_rapport: date,
                            generated: `${date} a ${heure}` };
    const tmp = `/tmp/rapport_inscriptions_${Date.now()}.pdf`;

    execFileSync('python3', [
      '/app/scripts/gen_rapport_inscriptions.py',
      tmp,
      JSON.stringify(statsEnriched),
    ], { timeout: 120000 });

    if (!fs.existsSync(tmp)) {
      console.error('[rapport-cron] PDF non généré');
      return;
    }

    const pdfBuffer = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    console.log(`[rapport-cron] ✅ PDF généré (${pdfBuffer.length} bytes)`);

    // ── 3. Construire l'email HTML ──────────────────────
    const ins   = stats.insight || {};
    const kpis  = stats.kpis   || {};
    const fmt   = n => (n||0).toLocaleString('fr-FR');
    const fmtP  = n => `${parseFloat(n||0).toFixed(1)}%`;

    // Chiffres du jour depuis la timeline
        const buckets = stats.timeline && stats.timeline.buckets || [];
    var sortedBucketsAll = buckets.slice().sort(function(a,b){
      var pa = (a.label||'').split('/');
      var pb = (b.label||'').split('/');
      var da = pa.length===2 ? new Date(2026,parseInt(pa[1])-1,parseInt(pa[0])) : new Date(0);
      var db = pb.length===2 ? new Date(2026,parseInt(pb[1])-1,parseInt(pb[0])) : new Date(0);
      return da - db;
    });
    var todayCtp = 0, todayPsm = 0, todayLabel = '';
    var nonEmptyAll = sortedBucketsAll.filter(function(b){ return (b.ctp||0)+(b.psm||0)>0; });
    if (nonEmptyAll.length > 0) {
      var lastB = nonEmptyAll[nonEmptyAll.length-1];
      todayCtp = lastB.ctp||0; todayPsm = lastB.psm||0; todayLabel = lastB.label||'';
    }
    const enrolled    = ins.enrolled    || kpis.enrolled    || 0;
    const ctpEnrolled = ins.ctpEnrolled || 0;
    const psmWallet   = ins.psmWallet   || 0;
    const psmCarte    = ins.psmCarteVia || 0;
    const psmTotal    = psmCarte + psmWallet + (ins.psmVirement||0);

    // Calcul évolution vs veille
    const psmVirement = ins.psmVirement || 0;
    const webCount  = ins.webCount  || 0;
    const mobCount  = ins.mobCount  || 0;
    const ussdCount = ins.ussdCount || 0;
    // Trier les buckets par date réelle (DD/MM)
    var bucketsNonEmpty = sortedBucketsAll.filter(function(b){ return (b.ctp||0)+(b.psm||0)>0; });
    var v_ctp = 0, v_psm = 0;
    if (bucketsNonEmpty.length >= 2) {
      v_ctp = bucketsNonEmpty[bucketsNonEmpty.length-2].ctp || 0;
      v_psm = bucketsNonEmpty[bucketsNonEmpty.length-2].psm || 0;
    }
    const evolAbs = (todayCtp + todayPsm) - (v_ctp + v_psm);
    const evolPct = (v_ctp + v_psm) > 0 ? Math.round(Math.abs(evolAbs)/(v_ctp+v_psm)*100) : 0;
    const evolSign = evolAbs >= 0 ? '+' : '-';

    // Bloc journée du jour
    var jourBlock = '';
    if (todayLabel) {
      var evolLine = '';
      if ((v_ctp + v_psm) > 0) {
        var col = evolAbs >= 0 ? '#059669' : '#DC2626';
        evolLine = '<p style="color:#374151;font-size:13.5px;line-height:2;margin:12px 0 0 0;">'
          + 'Cette performance représente une progression de '
          + '<strong style="color:' + col + ';">' + evolSign + fmt(Math.abs(evolAbs)) + ' inscription' + (Math.abs(evolAbs) > 1 ? 's' : '') + ' supplémentaire' + (Math.abs(evolAbs) > 1 ? 's' : '') + '</strong>'
          + ' par rapport à la veille, soit une variation de '
          + '<strong style="color:' + col + ';">' + evolSign + evolPct + '\u00a0%</strong>.</p>';
      }
      jourBlock = '<div style="background:#EFF6FF;border-left:4px solid #2563EB;padding:18px 22px;border-radius:0 8px 8px 0;margin-bottom:24px;">'
        + '<div style="color:#1E3A5F;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">'
        + 'Journée du ' + todayLabel + ' — jusqu\u2019à ' + heure + '</div>'
        + '<p style="color:#374151;font-size:13.5px;line-height:2;margin:0 0 8px 0;">'
        + 'Pour la seule journée du <strong>' + todayLabel + '</strong>, '
        + '<strong style="color:#0F2444;font-size:15px;">' + fmt(todayCtp + todayPsm) + ' inscriptions</strong>'
        + ' ont été enregistrées, réparties entre :</p>'
        + '<ul style="color:#374151;font-size:13.5px;line-height:2.2;margin:0;padding-left:20px;">'
        + '<li><strong>' + fmt(todayCtp) + '</strong> inscriptions via ClicToPay\u00a0;</li>'
        + '<li><strong>' + fmt(todayPsm) + '</strong> inscriptions via Paysmart.</li>'
        + '</ul>' + evolLine + '</div>';
    }

    var virLine = psmVirement > 0 ? ', et <strong>' + fmt(psmVirement) + '</strong> par virement' : '';

    const htmlEmail = '<!DOCTYPE html>'
      + '<html lang="fr"><head><meta charset="UTF-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
      + '<body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif;">'
      + '<div style="max-width:660px;margin:0 auto;padding:24px 0;">'

      // Header
      + '<div style="background:#0F2444;padding:28px 36px;border-radius:12px 12px 0 0;">'
      + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
      + '<td><div style="color:#93C5FD;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Monétique Tunisie &nbsp;·&nbsp; Paysmart &nbsp;·&nbsp; ClicToPay</div>'
      + '<div style="color:#FFFFFF;font-size:22px;font-weight:700;line-height:1.3;margin-bottom:4px;">Inscriptions scolaires en ligne</div>'
      + '<div style="color:#94A3B8;font-size:12px;">Rapport de situation — Campagne nationale de paiement</div></td>'
      + '<td align="right" valign="top" style="padding-left:16px;white-space:nowrap;">'
      + '<div style="background:#1E3A5F;color:#F59E0B;font-size:12px;font-weight:700;padding:10px 16px;border-radius:24px;">'
      + date + ' à ' + heure + '</div></td></tr></table></div>'
      + '<div style="height:4px;background:linear-gradient(90deg,#F59E0B,#FBBF24,#D97706);"></div>'

      // Corps
      + '<div style="background:#FFFFFF;padding:28px 36px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;">'
      + '<p style="color:#374151;font-size:14px;line-height:1.8;margin:0 0 20px 0;">Bonjour,</p>'
      + '<p style="color:#374151;font-size:14px;line-height:1.8;margin:0 0 24px 0;">'
      + 'Veuillez trouver ci-dessous la situation de la campagne des inscriptions scolaires, '
      + 'arrêtée au <strong>' + date + '</strong> à <strong>' + heure + '</strong>.</p>'

      // Situation globale
      + '<div style="background:#F0FDF4;border-left:4px solid #059669;padding:18px 22px;border-radius:0 8px 8px 0;margin-bottom:24px;">'
      + '<div style="color:#064E3B;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Situation globale depuis le lancement</div>'
      + '<p style="color:#374151;font-size:13.5px;line-height:2;margin:0;">Depuis le lancement de la campagne le <strong>20/08/2026</strong>, un total de <strong style="color:#0F2444;font-size:15px;">' + fmt(enrolled) + ' élèves</strong> ont été inscrits via le système SMT.</p>'
      + '<p style="color:#374151;font-size:13.5px;line-height:2;margin:10px 0 0 0;">La répartition des inscriptions est la suivante :</p>'
      + '<ul style="color:#374151;font-size:13.5px;line-height:2.2;margin:6px 0 0 0;padding-left:20px;">'
      + '<li><strong>' + fmt(ctpEnrolled) + '</strong> inscriptions par carte bancaire via <strong>ClicToPay</strong>, dont <strong>' + fmt(psmCarte) + '</strong> paiements effectués via le site Paysmart\u00a0;</li>'
      + '<li><strong>' + fmt(psmWallet) + '</strong> inscriptions via les <strong>portefeuilles mobiles Paysmart</strong>' + virLine + '.</li>'
      + '</ul>'
      + '<p style="color:#374151;font-size:13.5px;line-height:2;margin:10px 0 0 0;">Le montant total encaissé à ce jour s\u2019élève à <strong style="color:#0F2444;">' + fmt(Math.round(kpis.amount||0)) + ' TND</strong>.</p>'
      + '<p style="color:#374151;font-size:13.5px;line-height:2;margin:6px 0 0 0;">Le taux de réussite global des paiements est de <strong>' + fmtP(kpis.successRate) + '</strong>, et atteint <strong>' + fmtP(kpis.adjustedRate) + '</strong> après exclusion des sessions expirées.</p>'
      + '</div>'

      // Canaux
      + '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:18px 22px;margin-bottom:24px;">'
      + '<div style="color:#0F2444;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px;">Canaux de paiement Paysmart</div>'
      + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
      + '<td width="33%" style="text-align:center;padding:10px;"><div style="color:#0F2444;font-size:22px;font-weight:700;">' + fmt(webCount) + '</div><div style="color:#6B7280;font-size:11px;margin-top:5px;">Transactions WEB</div></td>'
      + '<td width="33%" style="text-align:center;padding:10px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;"><div style="color:#0F2444;font-size:22px;font-weight:700;">' + fmt(mobCount) + '</div><div style="color:#6B7280;font-size:11px;margin-top:5px;">Transactions MOBILE</div></td>'
      + '<td width="33%" style="text-align:center;padding:10px;"><div style="color:#0F2444;font-size:22px;font-weight:700;">' + fmt(ussdCount) + '</div><div style="color:#6B7280;font-size:11px;margin-top:5px;">Transactions USSD</div></td>'
      + '</tr></table></div>'

      // Journée
      + jourBlock

      // Analyse
      + '<p style="color:#374151;font-size:13.5px;line-height:2;margin:0 0 24px 0;">La campagne continue d\u2019enregistrer une dynamique soutenue, avec une forte contribution des paiements par carte bancaire et une montée progressive de l\u2019usage des différents canaux Paysmart.</p>'
      + '<p style="color:#374151;font-size:14px;line-height:1.8;margin:20px 0 4px 0;">Cordialement,</p>'
      + '<p style="color:#0F2444;font-size:14px;font-weight:700;margin:0 0 24px 0;">L\u2019équipe Monétique Tunisie</p>'
      + '<div style="background:#F1F5F9;border-radius:8px;padding:14px 18px;font-size:11px;color:#64748B;line-height:1.8;">'
      + '<strong>* Taux ajusté :</strong> calculé après exclusion des ' + fmt(kpis.timeoutCount||0) + ' sessions expirées (formulaires non finalisés dans le délai imparti).<br>'
      + '<strong>Note méthodologique :</strong> Les ' + fmt(psmCarte) + ' paiements par carte via Paysmart transitent par ClicToPay et sont inclus dans les ' + fmt(ctpEnrolled) + ' inscriptions CTP — Total\u00a0: ' + fmt(ctpEnrolled) + ' + ' + fmt(psmWallet) + ' = ' + fmt(enrolled) + '.</div>'
      + '</div>'

      // Footer
      + '<div style="background:#0F2444;padding:18px 36px;border-radius:0 0 12px 12px;">'
      + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
      + '<td><div style="color:#93C5FD;font-size:11px;font-weight:700;">SMT &nbsp;·&nbsp; ClicToPay &nbsp;·&nbsp; Paysmart</div>'
      + '<div style="color:#475569;font-size:10px;margin-top:4px;">Monétique Tunisie — Document confidentiel — ' + date + ' à ' + heure + '</div></td>'
      + '<td align="right"><div style="color:#64748B;font-size:10px;">Le rapport PDF détaillé est joint à cet e-mail.</div></td>'
      + '</tr></table></div>'
      + '</div></body></html>';

    const { sendMail } = require('../config/mailer');
    const to = 'wissem.baghdadi@monetiquetunisie.com';
    const subject = '[SMT] Inscriptions scolaires — Situation au ' + date + ' à ' + heure + ' — ' + fmt(enrolled) + ' élèves inscrits';
    await sendMail({
      to,
      cc: [],
      subject,
      html: htmlEmail,
      attachments: [{
        filename: 'Rapport_Inscriptions_' + date.replace(/\//g,'-') + '_' + heure.replace(':','h') + '.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });
    console.log('[rapport-cron] Email envoye vers ' + to);

    // Sauvegarder aussi localement
    const rapportsDir = '/app/rapports';
    fs.mkdirSync(rapportsDir, { recursive: true });
    const dest = path.join(rapportsDir,
      `Rapport_Inscriptions_${date.replace(/\//g,'-')}_${heure.replace(':','h')}.pdf`);
    fs.writeFileSync(dest, pdfBuffer);
    console.log(`[rapport-cron] 💾 Sauvegardé : ${dest}`);

  } catch(e) {
    console.error('[rapport-cron] ❌', e.message);
  }
}

function start(app) {
  const msUntilNextHour = () => {
    const now  = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next - now;
  };

  setTimeout(async () => {
    await genererEtEnvoyerRapport(app);
    setInterval(() => genererEtEnvoyerRapport(app), 60 * 60 * 1000);
  }, msUntilNextHour());

  const waitMin = Math.round(msUntilNextHour() / 60000);
  console.log(`[rapport-cron] ✅ Démarré — prochain rapport dans ~${waitMin} min`);
}

module.exports = { start, genererEtEnvoyerRapport };
