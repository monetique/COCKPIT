// config/email-prise-en-charge.js
// Template email de prise en charge — modèle validé ClicToPay
// Inclut : paramètres d'accès TEST + cahier de recettes en pièce jointe (JSZip)
const path = require('path');
const fs   = require('fs');

// ── Génération de la référence dossier ───────────────────
function generateRef(processingId) {
  const now   = new Date();
  const d     = now.toISOString().slice(0,10).replace(/-/g,'');
  const short = (processingId || '').slice(-4).toUpperCase();
  const rand  = Math.random().toString(36).slice(2,6).toUpperCase();
  return `CTP-${d}-${short}-${rand}`;
}

// ── Paramètres TEST par défaut ────────────────────────────
const TEST_PARAMS = {
  apiUrl       : process.env.CTP_TEST_API_URL      || 'https://test.clictopay.com/payment/rest',
  monitoringUrl: process.env.CTP_TEST_MONITOR_URL  || 'https://test.clictopay.com/epg_gui/',
  supportEmail : process.env.CTP_SUPPORT_EMAIL     || 'webmaster@clictopay.com',
  logoUrl      : process.env.CTP_LOGO_URL          || '',
  website      : process.env.CTP_WEBSITE           || 'www.clictopay.com',
};

// ── Générer les credentials TEST pour un marchand ────────
function generateTestCredentials(processingId, terminalId) {
  // LOGIN = terminal_id obligatoirement (identique à BPCUSERTAB.LOGIN)
  const apiUser     = (terminalId && terminalId.trim()) ? terminalId.trim() : processingId;
  const apiPwd      = 'Ey0m4Q3AfY1p';
  const monitorUser = `${apiUser}_OP`;
  const monitorPwd  = apiPwd;

  return { apiUser, apiPwd, monitorUser, monitorPwd };
}

// ── Construire le cahier de recettes pré-rempli (xlsx) ───
// Utilise JSZip (déjà installé) — sauvegarde dans cahiers_outbox
async function buildCahierRecettes(merchant, ref, creds) {

  console.log('[cahier] Début génération pour', merchant.processing_id, '| ref:', ref);

  // ── 1. Localiser le template ────────────────────────────
  const ROOT = path.join(__dirname, '..');
  const candidates = [
    path.join(ROOT, 'CahierDesRecettes_TEMPLATE.xlsx'),
    path.join(ROOT, 'cahiers_inbox', 'CahierDesRecettes_TEMPLATE.xlsx'),
    path.join(process.cwd(), 'CahierDesRecettes_TEMPLATE.xlsx'),
  ];

  let srcPath = null;
  for (const p of candidates) {
    console.log('[cahier] Cherche template :', p, '->', fs.existsSync(p) ? '✅' : '❌');
    if (fs.existsSync(p)) { srcPath = p; break; }
  }

  if (!srcPath) {
    console.error('[cahier] ❌ Template introuvable — copiez CahierDesRecettes_TEMPLATE.xlsx dans', ROOT);
    return null;
  }
  console.log('[cahier] Template trouvé :', srcPath);

  // ── 2. Créer le répertoire cahiers_outbox ───────────────
  const OUTBOX = path.join(ROOT, 'cahiers_outbox');
  if (!fs.existsSync(OUTBOX)) {
    fs.mkdirSync(OUTBOX, { recursive: true });
    console.log('[cahier] Répertoire créé :', OUTBOX);
  }

  // ── 3. Charger JSZip ────────────────────────────────────
  let JSZip;
  try {
    JSZip = require('jszip');
    console.log('[cahier] JSZip chargé via require');
  } catch(e1) {
    console.warn('[cahier] require(jszip) échoué:', e1.message, '— tentative chemin absolu');
    try {
      JSZip = require(path.join(ROOT, 'node_modules', 'jszip'));
      console.log('[cahier] JSZip chargé via chemin absolu');
    } catch(e2) {
      console.error('[cahier] ❌ JSZip introuvable :', e2.message, '— lancez: npm install jszip');
      return null;
    }
  }

  // ── 4. Lire et patcher le xlsx ──────────────────────────
  try {
    const rawBuffer = fs.readFileSync(srcPath);
    console.log('[cahier] Template lu :', rawBuffer.length, 'bytes');

    const zip = await JSZip.loadAsync(rawBuffer);
    const xmlFiles = Object.keys(zip.files).filter(f =>
      !zip.files[f].dir && (f.endsWith('.xml') || f.endsWith('.rels'))
    );
    console.log('[cahier] Fichiers XML dans le zip :', xmlFiles.length);

    // Échapper XML
    const esc = s => String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&apos;');

    const replacements = {
      '{{RAISON_SOCIALE}}' : esc(merchant.raison_sociale || ''),
      '{{PROCESSING_ID}}'  : esc(merchant.processing_id  || ''),
      '{{TERMINAL_ID}}'    : esc(merchant.terminal_id    || ''),
      '{{DATE_EXECUTION}}'  : esc(new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' })),
      '{{MCC}}'            : esc(merchant.mcc            || ''),
      '{{SITE_URL}}'       : esc(merchant.site_web       || ''),
      '{{EMAIL}}'          : esc(merchant.email_contact  || ''),
      '{{TRACKING_REF}}'   : esc(ref                     || ''),
      '{{API_URL}}'        : esc(TEST_PARAMS.apiUrl),
      '{{API_USER}}'       : esc(creds.apiUser),
      '{{API_PWD}}'        : esc(creds.apiPwd),
      '{{MONITORING_URL}}' : esc(TEST_PARAMS.monitoringUrl),
      '{{MONITOR_USER}}'   : esc(creds.monitorUser),
      '{{MONITOR_PWD}}'    : esc(creds.monitorPwd),
    };

    let totalReplacements = 0;
    for (const filename of xmlFiles) {
      let content = await zip.files[filename].async('string');
      let changed = false;
      for (const [ph, val] of Object.entries(replacements)) {
        if (content.includes(ph)) {
          content = content.split(ph).join(val);
          changed = true;
          totalReplacements++;
        }
      }
      if (changed) zip.file(filename, content);
    }
    console.log('[cahier] Total remplacements :', totalReplacements);

    // ── 5. Générer le buffer final ──────────────────────
    const outBuffer = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE' });
    console.log('[cahier] Buffer généré :', outBuffer.length, 'bytes');

    // ── 6. Sauvegarder dans cahiers_outbox ──────────────
    const filename  = `CahierDesRecettes_${merchant.processing_id}_${ref}.xlsx`;
    const outPath   = path.join(OUTBOX, filename);
    fs.writeFileSync(outPath, outBuffer);
    console.log('[cahier] ✅ Sauvegardé dans outbox :', outPath);

    return {
      filename,
      content    : outBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

  } catch(e) {
    console.error('[cahier] ❌ Erreur génération :', e.message);
    console.error(e.stack);
    return null;
  }
}

// ── Template HTML email ───────────────────────────────────
function buildEmailHTML(merchant, ref, creds) {
  const apiBase  = TEST_PARAMS.apiUrl;
  const monUrl   = TEST_PARAMS.monitoringUrl;
  const support  = TEST_PARAMS.supportEmail;
  const year     = new Date().getFullYear();

  const row = (label, value, secret=false, bg='#fff') =>
    `<tr style="background:${bg}">
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;width:45%;font-size:12px">${label}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-family:'Courier New',monospace;font-weight:700;color:${secret?'#dc2626':'#0f2444'};font-size:12px;word-break:break-all">${value||'—'}</td>
    </tr>`;

  return `<!DOCTYPE html><html lang="fr"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:Arial,sans-serif;background:#f4f6f9;}
  .wrap{max-width:620px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden;}
  .hdr{background:#0f2444;padding:20px 32px;}
  .hdr-title{color:#fff;font-size:16px;font-weight:700;}
  .hdr-sub{color:#93c5fd;font-size:11px;margin-top:4px;}
  .hdr-badge{display:inline-block;background:#2563eb;color:#fff;padding:3px 12px;border-radius:20px;font-size:10px;font-weight:700;margin-top:8px;}
  .hdr-ref{font-family:'Courier New',monospace;font-size:10px;color:#60a5fa;margin-top:6px;}
  .body{padding:24px 32px;}
  .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 32px;text-align:center;font-size:10px;color:#94a3b8;}
  .cards-table{width:100%;border-collapse:collapse;font-size:12px;}
  .cards-table td{padding:8px 12px;border:1px solid #e2e8f0;vertical-align:top;width:50%;}
  .badge-ok{display:inline-block;background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;margin-bottom:6px;}
  .badge-ko{display:inline-block;background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;margin-bottom:6px;}
</style>
</head><body>
<div class="wrap">

  <!-- HEADER -->
  <div class="hdr">
    <div class="hdr-title">ClicToPay — Bienvenue sur la plateforme</div>
    <div class="hdr-sub">Vos paramètres d'accès à l'environnement de test (sandbox)</div>
    <div class="hdr-badge">⚡ TEST ACTIVÉ</div>
    <div class="hdr-ref">Réf. ${ref}</div>
  </div>

  <!-- BODY -->
  <div class="body">

    <p style="margin-bottom:14px;font-size:13px;font-weight:600">Madame, Monsieur,</p>
    <p style="margin-bottom:14px;font-size:13px;color:#475569;line-height:1.75">
      Nous sommes ravis de vous accueillir sur la plateforme de paiement en ligne
      <strong>ClicToPay</strong> et vous remercions chaleureusement pour votre confiance.<br>
      Votre espace marchand <strong>${merchant.raison_sociale}</strong> a été créé avec succès.
      Vous trouverez ci-dessous vos paramètres d'accès à l'environnement de test.
    </p>

    <!-- ESPACE MARCHAND -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#0f2444">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          🏪 INFORMATIONS MARCHAND
        </th>
      </tr></thead>
      <tbody>
        ${row('Raison sociale', merchant.raison_sociale, false, '#fff')}
        ${row('Processing ID',  merchant.processing_id,  false, '#f8fafc')}
        ${merchant.terminal_id ? row('Terminal ID', merchant.terminal_id, false, '#fff') : ''}
        ${merchant.site_web && merchant.site_web !== '—' ? row('Site marchand', merchant.site_web, false, '#f8fafc') : ''}
      </tbody>
    </table>

    <!-- API PAIEMENT TEST -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#1d4ed8">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          🔗 API PAIEMENT — ENVIRONNEMENT TEST
        </th>
      </tr></thead>
      <tbody>
        ${row('URL API',           apiBase + '/register.do', false, '#fff')}
        ${row("Nom d'utilisateur", creds.apiUser,            false, '#f8fafc')}
        ${row('Mot de passe',      creds.apiPwd,             true,  '#fff')}
      </tbody>
    </table>

    <!-- PORTAIL MONITORING TEST -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#15803d">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          📊 PORTAIL MONITORING — ENVIRONNEMENT TEST
        </th>
      </tr></thead>
      <tbody>
        ${row('URL du portail',    monUrl,            false, '#fff')}
        ${row("Nom d'utilisateur", creds.monitorUser, false, '#f8fafc')}
        ${row('Mot de passe',      creds.monitorPwd,  true,  '#fff')}
      </tbody>
    </table>

    <!-- SÉCURITÉ -->
    <div style="background:#fff7ed;border-left:3px solid #f59e0b;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#78350f">
      ⚠️ <strong>Sécurité — Action requise :</strong> Ces identifiants sont strictement confidentiels.
      Modifiez vos mots de passe dès votre première connexion. Ne les communiquez à aucun tiers.
    </div>

    <!-- CARTES DE TEST -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#d97706">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          💳 CARTES DE TEST DISPONIBLES
        </th>
      </tr></thead>
      <tbody><tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;width:50%">
          <span class="badge-ok">✅ Paiement accepté</span><br>
          <span style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:#0f2444">4509 2111 1111 1119</span><br>
          <span style="font-size:11px;color:#475569">Exp. 12/26 · CVV 748</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;width:50%">
          <span class="badge-ko">❌ Paiement refusé</span><br>
          <span style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:#0f2444">5104 0511 1111 1115</span><br>
          <span style="font-size:11px;color:#475569">Exp. 12/29 · CVV 749</span>
        </td>
      </tr>
      <tr><td colspan="2" style="padding:6px 12px;font-size:11px;color:#64748b;font-style:italic">
        Ces cartes sont à usage exclusif dans l'environnement sandbox.
      </td></tr>
      </tbody>
    </table>

    <!-- ÉTAPES D'INTÉGRATION -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#475569">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          🔧 ÉTAPES D'INTÉGRATION (Obligatoire)
        </th>
      </tr></thead>
      <tbody>
        <tr style="background:#fff">
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;width:26px;text-align:center;vertical-align:top">
            <span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;font-size:10px;font-weight:700;text-align:center;line-height:20px;font-family:'Courier New',monospace">1</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">
            <strong>Initialisation — <span style="font-family:'Courier New',monospace;background:#eff6ff;padding:1px 5px;border-radius:3px;color:#2563eb;font-size:11px">register.do</span></strong><br>
            <span style="color:#475569;font-size:11px">Paramètres requis : userName · password · orderNumber · amount · currency (788=TND) · returnUrl · failUrl</span>
          </td>
        </tr>
        <tr style="background:#f8fafc">
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;vertical-align:top">
            <span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;font-size:10px;font-weight:700;text-align:center;line-height:20px;font-family:'Courier New',monospace">2</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">
            <strong>Redirection client</strong><br>
            <span style="color:#475569;font-size:11px">Le client est redirigé vers la page de paiement ClicToPay pour saisir et valider ses informations.</span>
          </td>
        </tr>
        <tr style="background:#fff">
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;vertical-align:top">
            <span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;font-size:10px;font-weight:700;text-align:center;line-height:20px;font-family:'Courier New',monospace">3</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">
            <strong>Vérification statut — <span style="font-family:'Courier New',monospace;background:#eff6ff;padding:1px 5px;border-radius:3px;color:#2563eb;font-size:11px">getOrderStatusExtended.do</span></strong><br>
            <span style="color:#475569;font-size:11px">À appeler <strong>uniquement après la redirection</strong> — jamais juste après register.do.</span>
          </td>
        </tr>
        <tr style="background:#f8fafc">
          <td style="padding:8px 12px;text-align:center;vertical-align:top">
            <span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;font-size:10px;font-weight:700;text-align:center;line-height:20px;font-family:'Courier New',monospace">4</span>
          </td>
          <td style="padding:8px 12px">
            <strong>Décision selon orderStatus</strong><br>
            <span style="color:#475569;font-size:11px"><strong>orderStatus = 2</strong> → Paiement autorisé → returnUrl &nbsp;|&nbsp; <strong>Autre</strong> → Paiement échoué → failUrl</span>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- ERREUR FRÉQUENTE -->
    <div style="background:#fef2f2;border-left:3px solid #dc2626;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#991b1b">
      🚫 <strong>Erreur fréquente :</strong> Ne jamais rediriger vers une page de succès sans avoir
      vérifié le statut via <strong>getOrderStatusExtended.do</strong>.
    </div>

    <!-- TESTS À RÉALISER -->
    <div style="background:#eff6ff;border-left:3px solid #2563eb;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#1e40af">
      🧪 <strong>Tests à réaliser :</strong> Paiement accepté · Paiement refusé ·
      Redirections returnUrl / failUrl · Vérification statut via API
    </div>

    <!-- PHASE 2 PRODUCTION -->
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#15803d">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">
          🚀 PHASE 2 — PASSAGE EN PRODUCTION
        </th>
      </tr></thead>
      <tbody><tr><td colspan="2" style="padding:10px 12px;font-size:12px;color:#475569;line-height:1.75">
        Une fois vos tests validés, notre équipe procédera à la validation technique de votre intégration.
        Après l'envoi de la grille de validation, merci de prévoir un délai d'une semaine.
        Sans retour de notre part, nous vous invitons à nous adresser un e-mail de relance à
        <a href="mailto:${support}" style="color:#1d4ed8">${support}</a>.
      </td></tr></tbody>
    </table>

    <p style="margin-bottom:6px;font-size:13px">
      Nous vous souhaitons une excellente intégration et restons à votre disposition.
    </p>
    <p style="margin-bottom:14px;font-size:13px">
      Bien cordialement,<br>
      <strong>L'équipe ClicToPay — Monetique Tunisie</strong><br>
      <span style="color:#2563eb">${support}</span>
    </p>

  </div>

  <!-- FOOTER -->
  <div class="footer">
    ClicToPay · Monetique Tunisie · Plateforme de paiement électronique sécurisée · ${year}
  </div>

</div>
</body></html>`;
}

module.exports = { generateRef, generateTestCredentials, buildCahierRecettes, buildEmailHTML, TEST_PARAMS };
