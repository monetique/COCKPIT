// src/components/merchants/WelcomeModal.jsx
import { useState, useEffect } from 'react';
import { X, Send, Mail, AlertCircle } from 'lucide-react';
import { sendWelcome } from '@/api/merchants';
import { Spinner }     from '@/components/ui';
import toast           from 'react-hot-toast';
import client          from '@/api/client';

export default function WelcomeModal({ merchant, excelRow, onClose, onSent }) {
  const [email,   setEmail]   = useState('');
  const [sending, setSending] = useState(false);
  const [ccList,  setCcList]  = useState('');

  useEffect(() => {
    // Pré-remplir l'email — priorité Webmaster puis Email (colonnes réelles du fichier)
    const addr = excelRow?._email
      || excelRow?.Webmaster || excelRow?.Email
      || excelRow?.email || '';
    setEmail(addr);
    client.get('/config/smtp-cc').then(r => setCcList(r.data.cc || '')).catch(() => {});
  }, [excelRow]);

  const handleSend = async () => {
    if (!email.trim()) { toast.error('Email requis'); return; }
    setSending(true);
    try {
      const excelRowForApi = {
        ...excelRow,
        Email    : email,
        Webmaster: email,
        URL      : excelRow?._url  || excelRow?.URL  || '',
        MCC      : excelRow?._mcc  || excelRow?.MCC  || '',
      };
      const { data } = await sendWelcome({ merchant, excelRow: excelRowForApi });
      toast.success(
        `📧 Email envoyé → ${email}\n` +
        `📎 Cahier des recettes ${data.excelJoined ? 'joint ✓' : 'non joint'}\n` +
        `📄 Manuel d'intégration ${data.manuelJoined ? 'joint ✓' : 'non joint'}\n` +
        `📋 Réf: ${data.trackingRef}`,
        { duration: 6000 }
      );
      onSent?.({ email, trackingRef: data.trackingRef, credentials: data.credentials });
      onClose();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur envoi email');
    } finally {
      setSending(false);
    }
  };

  const pid  = merchant?.PROCESSING_ID || '—';
  const name = merchant?.MERCHANTFULLNAME || pid;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface border border-border2 rounded-xl w-full max-w-lg shadow-2xl animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
              <Mail size={15} className="text-brand" />
            </div>
            <div>
              <div className="text-sm font-semibold text-primary">Email de bienvenue</div>
              <div className="text-xs text-tertiary font-mono">{pid}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-tertiary hover:text-primary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Infos marchand */}
          <div className="bg-surface2 rounded-lg p-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-tertiary">Raison sociale</span>
              <span className="text-primary font-medium">{name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Processing ID</span>
              <span className="font-mono text-brand">{pid}</span>
            </div>
            {merchant?.TERMINAL_ID && (
              <div className="flex justify-between">
                <span className="text-tertiary">Terminal ID</span>
                <span className="font-mono text-secondary">{merchant.TERMINAL_ID}</span>
              </div>
            )}
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Email destinataire *
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="webmaster@marchand.com"
              className="input"
              autoFocus
            />
          </div>

          {/* CC */}
          {ccList && (
            <div className="text-xs text-tertiary bg-surface2 rounded-lg px-3 py-2">
              <span className="text-secondary font-medium">CC : </span>
              <span className="font-mono">{ccList}</span>
            </div>
          )}

          {/* Info pièce jointe */}
          <div className="flex items-start gap-2 text-xs text-info bg-info-dim border border-info/20 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>
              Le cahier des recettes Excel sera généré automatiquement et joint à l'email avec les credentials TEST.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="btn-ghost btn-sm">Annuler</button>
          <button
            onClick={handleSend}
            disabled={sending || !email.trim()}
            className="btn-primary btn-sm"
          >
            {sending ? <Spinner size={13}/> : <Send size={13}/>}
            {sending ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  );
}
