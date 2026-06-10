// src/components/validation/ProdEmailModal.jsx
import { useState, useEffect } from 'react';
import { X }        from 'lucide-react';
import { Spinner }  from '@/components/ui';
import { generateProdCredentials, sendProdEmail, markProdEmailSent } from '@/api/validation';
import client from '@/api/client';
import toast  from 'react-hot-toast';

export default function ProdEmailModal({ result, validationId, onClose, onSent }) {
  const [creds,   setCreds]   = useState(null);
  const [to,      setTo]      = useState('');
  const [subject, setSubject] = useState('');
  const [ccList,  setCcList]  = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const m = result.merchant;
    client.get('/config/smtp-cc').then(r => setCcList(r.data.cc || '')).catch(() => {});

    // Toujours résoudre siteUrl depuis la DB — source de vérité
    const fetchAndGenerate = async () => {
      let siteUrl = '';
      try {
        const { data: dossier } = await client.get(`/tracking/${m.processingId}`);
        siteUrl = dossier?.dossier?.site_url || dossier?.dossier?.site_web || '';
      } catch(e) { /* ignore */ }

      generateProdCredentials({
        processingId: m.processingId,
        merchantName: m.raisonSociale,
        terminalId  : m.terminalId,
        email       : m.email,
        siteUrl,
      }).then(({ data }) => {
        setCreds({ ...data, siteUrl });
        setTo(m.email || '');
        setSubject(`[ClicToPay · ${data.trackingRef}] Passage en production — ${m.raisonSociale || m.processingId}`);
        setLoading(false);
      }).catch(e => {
        toast.error('Erreur génération credentials : ' + e.message);
        onClose();
      });
    };

    fetchAndGenerate();
  }, [result]);

  const handleSend = async () => {
    if (!to.trim() || !creds) return;
    setSending(true);
    try {
      const htmlBody = buildProdHtml(result.merchant, creds);
      const siteUrl  = creds.siteUrl || result.merchant.siteUrl || '';
      await sendProdEmail({ to, subject, htmlBody,
        processingId: result.merchant.processingId,
        merchantName: result.merchant.raisonSociale });
      if (validationId) await markProdEmailSent(validationId);
      toast.success(`Email de production envoyé → ${to}`);
      onSent?.();
      onClose();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur envoi');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface border border-border2 rounded-xl w-full max-w-2xl shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-surface">
          <div className="text-sm font-semibold text-primary">🚀 Email de passage en production</div>
          <button onClick={onClose} className="text-tertiary hover:text-primary"><X size={16}/></button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Spinner size={28}/>
            <div className="text-xs text-tertiary">Génération des credentials…</div>
          </div>
        ) : (
          <div className="px-6 py-4 space-y-4">
            {/* Statut */}
            <div className="text-xs text-success bg-success-dim border border-success/20 rounded-lg px-4 py-2.5">
              ✅ Recettes approuvées — nouveaux credentials PRODUCTION générés
            </div>

            {/* Destinataire */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-tertiary mb-1">Email destinataire *</label>
                <input type="email" value={to} onChange={e => setTo(e.target.value)} className="input"/>
              </div>
              <div>
                <label className="block text-xs text-tertiary mb-1">Objet</label>
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="input text-xs"/>
              </div>
            </div>

            {/* CC */}
            {ccList && (
              <div className="text-xs text-tertiary bg-surface2 rounded-lg px-3 py-2">
                <span className="text-secondary font-medium">CC : </span>
                <span className="font-mono">{ccList}</span>
              </div>
            )}

            {/* Credentials */}
            {creds && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wide">Credentials générés</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ['API User',       creds.apiUser],
                    ['API Password',   creds.apiPwd],
                    ['Monitor User',   creds.monitorUser],
                    ['Monitor Pwd',    creds.monitorPwd],
                    ['Référence',      creds.trackingRef],
                  ].map(([l, v]) => (
                    <div key={l} className="bg-surface2 rounded px-3 py-2">
                      <div className="text-tertiary">{l}</div>
                      <div className="font-mono text-primary font-medium">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="btn-ghost btn-sm">Annuler</button>
          <button onClick={handleSend} disabled={sending || loading || !to}
            className="btn-primary btn-sm">
            {sending ? <Spinner size={13}/> : '🚀'}
            {sending ? 'Envoi…' : 'Envoyer email production'}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildProdHtml(m, j) {
  const support = 'webmaster@clictopay.com';
  const year    = new Date().getFullYear();

  const row = (label, value, secret=false, bg='#fff') =>
    `<tr style="background:${bg}">
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;width:45%;font-size:12px">${label}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-family:'Courier New',monospace;font-weight:700;color:${secret?'#dc2626':'#0f2444'};font-size:12px">${value||'—'}</td>
    </tr>`;

  const secRow = (label, text, bg='#fff') =>
    `<tr style="background:${bg}">
      <td style="padding:8px 12px;border-bottom:1px solid #fecaca;color:#dc2626;font-weight:700;font-size:11px;width:30%;vertical-align:top">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #fecaca;color:#374151;font-size:12px">${text}</td>
    </tr>`;

  return `<!DOCTYPE html><html lang="fr"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:Arial,sans-serif;background:#f4f6f9;}
  .wrap{max-width:620px;margin:24px auto;background:#fff;border-radius:8px;
        box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden;}
  .hdr{background:#0f2444;padding:20px 32px;}
  .hdr-title{color:#fff;font-size:16px;font-weight:700;}
  .hdr-sub{color:#93c5fd;font-size:11px;margin-top:4px;}
  .hdr-badge{display:inline-block;background:#10b981;color:#fff;padding:3px 12px;
             border-radius:20px;font-size:10px;font-weight:700;margin-top:8px;}
  .hdr-ref{font-family:'Courier New',monospace;font-size:10px;color:#60a5fa;margin-top:6px;}
  .body{padding:24px 32px;}
  .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 32px;
          text-align:center;font-size:10px;color:#94a3b8;}
</style>
</head><body>
<div class="wrap">
  <div class="hdr">
    <div class="hdr-title">ClicToPay — Passage en Production</div>
    <div class="hdr-sub">Vos paramètres d'accès à l'environnement de production</div>
    <div class="hdr-badge">✓ PRODUCTION ACTIVÉE</div>
    <div class="hdr-ref">Réf. ${j.trackingRef}</div>
  </div>
  <div class="body">
    <p style="margin-bottom:14px;font-size:13px;font-weight:600">Madame, Monsieur,</p>
    <p style="margin-bottom:14px;font-size:13px">
      Nous avons le plaisir de vous informer que votre espace marchand
      <strong>${m.raisonSociale}</strong> est désormais activé sur l'environnement de
      <strong>PRODUCTION</strong>. Votre intégration a été validée avec succès.
    </p>
    <p style="margin-bottom:14px;font-size:13px">
      Veuillez trouver ci-dessous vos paramètres d'accès à la plateforme de production :
    </p>

    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#0f2444">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">🏪 INFORMATIONS MARCHAND</th>
      </tr></thead>
      <tbody>
        ${row('Raison sociale', m.raisonSociale, false, '#fff')}
        ${row('Processing ID',  m.processingId,  false, '#f8fafc')}
        ${row('Terminal ID',    m.terminalId||'—',false,'#fff')}
        ${j.siteUrl ? row('Site marchand', j.siteUrl, false, '#f8fafc') : ''}
      </tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#1d4ed8">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">🔗 API PAIEMENT — PRODUCTION</th>
      </tr></thead>
      <tbody>
        ${row('URL API',            j.apiUrl,     false, '#fff')}
        ${row("Nom d'utilisateur",  j.apiUser,    false, '#f8fafc')}
        ${row('Mot de passe',       j.apiPwd,     true,  '#fff')}
      </tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#15803d">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">📊 PORTAIL MONITORING — PRODUCTION</th>
      </tr></thead>
      <tbody>
        ${row('URL du portail',     j.monitoringUrl, false, '#fff')}
        ${row("Nom d'utilisateur",  j.monitorUser,   false, '#f8fafc')}
        ${row('Mot de passe',       j.monitorPwd,    true,  '#fff')}
      </tbody>
    </table>

    <div style="background:#fff7ed;border-left:3px solid #f59e0b;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#78350f">
      ⚠️ <strong>Sécurité — Action requise :</strong> Ces identifiants sont strictement confidentiels.
      Modifiez vos mots de passe dès la première connexion. Ne les communiquez à aucun tiers.
      Ne stockez jamais les données de carte bancaire sur vos serveurs.
    </div>

    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12px">
      <thead><tr style="background:#dc2626">
        <th colspan="2" style="color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.4px">🛡 CONSIGNES DE SÉCURITÉ ANTI-FRAUDE — OBLIGATOIRES</th>
      </tr></thead>
      <tbody>
        ${secRow('Transactions suspectes',
          "Signalez immédiatement à votre banque acquéreur toute transaction suspecte : montant élevé, plusieurs transactions avec le même numéro de carte / adresse IP / nom / e-mail / BIN (4 premiers chiffres de la carte).",
          '#fff')}
        ${secRow('Données clients',
          "Collectez le maximum d'informations lors de l'inscription de vos clients. Exigez un KYC (CIN, justificatif) pour permettre le rapprochement en cas de litige.",
          '#fef2f2')}
        ${secRow('Données de carte',
          "⛔ Ne stockez jamais les données de carte bancaire (numéro, CVV, date d'expiration) sur vos serveurs. Cette pratique est strictement interdite par les normes PCI-DSS.",
          '#fff')}
        ${secRow('Délai de livraison',
          "Assurez la livraison du produit ou service dans un délai minimum de 72h après le paiement, afin de permettre aux services anti-fraude des banques émettrices de réagir.",
          '#fef2f2')}
        ${secRow('Vérification identité',
          "Pour tout achat physique, exigez la pièce d'identité et la carte bancaire. Vérifiez la cohérence entre le nom sur la carte et le document d'identité présenté.",
          '#fff')}
        ${secRow('Vérification carte',
          "Comparez les données de la transaction (nom, BIN, expiration) avec la carte physique présentée par le porteur.",
          '#fef2f2')}
        ${secRow('Alertes transactions',
          "Activez les alertes de transaction sur votre portail de monitoring pour être notifié en temps réel des paiements et anomalies.",
          '#fff')}
        ${secRow('Contestations (Chargeback)',
          "En cas de contestation, conservez toutes les preuves de transaction (logs, confirmation de livraison, correspondances client) pendant au moins 18 mois.",
          '#fef2f2')}
      </tbody>
    </table>

    <p style="margin-bottom:6px;font-size:13px">Notre équipe reste disponible pour vous accompagner dans cette nouvelle étape.</p>
    <p style="margin-bottom:14px;font-size:13px">
      Bien cordialement,<br>
      <strong>L'équipe ClicToPay — Monetique Tunisie</strong><br>
      <span style="color:#2563eb">${support}</span>
    </p>
  </div>
  <div class="footer">
    ClicToPay · Monetique Tunisie · Plateforme de paiement électronique sécurisée · ${year}
  </div>
</div>
</body></html>`;
}


