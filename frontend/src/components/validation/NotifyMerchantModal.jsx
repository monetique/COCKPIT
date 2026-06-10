// src/components/validation/NotifyMerchantModal.jsx
import { useState, useEffect } from 'react';
import { X, Send }     from 'lucide-react';
import { Spinner }     from '@/components/ui';
import { notifyMerchant, markMerchantNotified } from '@/api/validation';
import client from '@/api/client';
import toast  from 'react-hot-toast';

const VERDICT_TEMPLATES = {
  approved: (m) => ({
    subject: `[ClicToPay] Validation recettes APPROUVÉE — ${m.raisonSociale || m.processingId}`,
    body   : `Bonjour,\n\nNous avons le plaisir de vous informer que votre cahier des recettes a été validé avec succès.\n\nTous les cas de test critiques ont été exécutés et approuvés. Votre boutique en ligne est désormais éligible au passage en environnement de production.\n\nVous serez contacté prochainement avec vos paramètres d'accès à la plateforme de production.\n\nBien cordialement,\nL'équipe ClicToPay — Monetique Tunisie`,
  }),
  refused: (m, r) => ({
    subject: `[ClicToPay] Validation recettes REFUSÉE — ${m.raisonSociale || m.processingId}`,
    body   : `Bonjour,\n\nNous avons analysé votre cahier des recettes et malheureusement nous ne pouvons pas valider votre intégration en l'état.\n\nCas échoués : ${r.fail}\nCas critiques réussis : ${r.criticalPass}/${r.criticalTotal}\n\nMerci de corriger les anomalies détectées et de nous retourner un nouveau cahier complété.\n\nBien cordialement,\nL'équipe ClicToPay — Monetique Tunisie`,
  }),
  pending: (m) => ({
    subject: `[ClicToPay] Cahier des recettes incomplet — ${m.raisonSociale || m.processingId}`,
    body   : `Bonjour,\n\nNous avons reçu votre cahier des recettes mais certains cas de test ne sont pas encore complétés.\n\nMerci de finaliser tous les cas de test et de nous retourner le fichier mis à jour.\n\nBien cordialement,\nL'équipe ClicToPay — Monetique Tunisie`,
  }),
};

export default function NotifyMerchantModal({ result, validationId, onClose, onSent }) {
  const [to,      setTo]      = useState('');
  const [subject, setSubject] = useState('');
  const [body,    setBody]    = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const m   = result.merchant;
    const tpl = VERDICT_TEMPLATES[result.verdict]?.(m, result) || VERDICT_TEMPLATES.pending(m);
    setTo(m.email || '');
    setSubject(tpl.subject);
    setBody(tpl.body);
  }, [result]);

  const handleSend = async () => {
    if (!to.trim()) { toast.error('Email requis'); return; }
    setSending(true);
    try {
      await notifyMerchant({
        to, subject, body,
        processingId: result.merchant.processingId,
      });
      if (validationId) await markMerchantNotified(validationId);
      toast.success(`Notification envoyée → ${to}`);
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
      <div className="bg-surface border border-border2 rounded-xl w-full max-w-lg shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="text-sm font-semibold text-primary">📧 Notifier le marchand</div>
          <button onClick={onClose} className="text-tertiary hover:text-primary"><X size={16}/></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-xs text-tertiary mb-1">Email *</label>
            <input type="email" value={to} onChange={e => setTo(e.target.value)} className="input"/>
          </div>
          <div>
            <label className="block text-xs text-tertiary mb-1">Objet</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="input"/>
          </div>
          <div>
            <label className="block text-xs text-tertiary mb-1">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)}
              rows={8} className="input resize-none font-mono text-xs"/>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="btn-ghost btn-sm">Annuler</button>
          <button onClick={handleSend} disabled={sending || !to} className="btn-primary btn-sm">
            {sending ? <Spinner size={13}/> : <Send size={13}/>}
            {sending ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  );
}
