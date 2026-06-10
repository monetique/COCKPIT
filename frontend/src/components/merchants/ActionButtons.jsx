// src/components/merchants/ActionButtons.jsx
// Boutons E.CR | REÇU | F.PROD | RESET | SUP pour le tableau des marchands
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Send, AlertTriangle, RotateCcw, Trash2, CheckCircle2 } from 'lucide-react';
import toast  from 'react-hot-toast';
import clsx   from 'clsx';
import { Spinner } from '@/components/ui';
import { resendCahier, forceProduction, resetProgression, getPayfacs } from '@/api/payfacs';
import { getBanks } from '@/api/banks';
import client from '@/api/client';
import useAuthStore from '@/store/authStore';

// ── Suppression depuis l'API tracking ────────────────────
// Route : DELETE /api/tracking/:processing_id
const deleteTracking = (processingId) =>
  client.delete(`/tracking/${processingId}`);

export default function ActionButtons({ merchant, onDone }) {
  const { user } = useAuthStore();
  const isAdminOrSupervisor = ['admin','supervisor'].includes(user?.role);
  const [modal,   setModal]   = useState(null); // 'fprod' | 'delete'
  const [loading, setLoading] = useState(null);

  const pid    = merchant.processing_id;
  const name   = merchant.raison_sociale;
  const email  = merchant.email_contact;
  const statut = merchant.statut;

  // ── REÇU — Marquer recettes_recues manuellement ───────
  const handleMarkReceived = async () => {
    if (!confirm(`Confirmer la réception des recettes de "${name}" ?`)) return;
    setLoading('recu');
    try {
      await client.post('/cahiers/mark-received', { processing_id: pid });
      toast.success(`📬 Recettes reçues — ${name}`);
      onDone?.();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur marquage');
    } finally {
      setLoading(null);
    }
  };

  // ── E.CR — Renvoyer le cahier ─────────────────────────
  const handleECR = async () => {
    setLoading('ecr');
    try {
      const { data } = await resendCahier({ processingId: pid });
      toast.success(
        `📨 Cahier renvoyé → ${email}\n` +
        (data.fileFound ? '📂 Fichier existant réutilisé' : '🔄 Fichier régénéré') +
        (data.fileGenerated === false && !data.fileFound ? '\n⚠️ Template manquant — email sans PJ' : ' ✓'),
        { duration: 5000 }
      );
      onDone?.();
    } catch(e) { toast.error(e.response?.data?.error || 'Erreur renvoi cahier'); }
    finally { setLoading(null); }
  };

  // ── RESET — Réinitialiser la progression ──────────────
  const handleReset = async () => {
    if (!confirm(`Réinitialiser la progression de "${name}" ?\nLe statut reviendra à "En attente".`)) return;
    setLoading('reset');
    try {
      await resetProgression({ processingId: pid });
      toast.success(`🔄 Progression réinitialisée — ${name}`);
      onDone?.();
    } catch(e) { toast.error(e.response?.data?.error || 'Erreur reset'); }
    finally { setLoading(null); }
  };

  // ── SUP — Supprimer de la base locale ─────────────────
  const handleDelete = async () => {
    setLoading('delete');
    try {
      await deleteTracking(pid);
      toast.success(`🗑 Marchand supprimé — ${name}`, { duration: 4000 });
      setModal(null);
      onDone?.();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur suppression');
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <div className="flex items-center justify-end gap-1">

        {/* E.CR */}
        <button onClick={handleECR} disabled={loading === 'ecr'}
          title="Renvoyer le cahier de recettes"
          className="btn-ghost btn-sm text-xs text-info hover:bg-info-dim px-2">
          {loading === 'ecr' ? <Spinner size={11}/> : 'E.CR'}
        </button>

        {/* REÇU — visible uniquement si en recettes_envoyees ou prise_en_charge */}
        {(statut === 'recettes_envoyees' || statut === 'prise_en_charge') && (
          <button onClick={handleMarkReceived} disabled={loading === 'recu'}
            title="Marquer les recettes comme reçues"
            className="btn-ghost btn-sm text-xs text-success hover:bg-success-dim px-2">
            {loading === 'recu' ? <Spinner size={11}/> : <><CheckCircle2 size={10}/> Reçu</>}
          </button>
        )}

        {/* F.PROD — admin/supervisor uniquement */}
        {isAdminOrSupervisor && (
        <button onClick={() => setModal('fprod')}
          title="Passage forcé en production"
          className="btn-ghost btn-sm text-xs text-success hover:bg-success-dim px-2">
          F.PROD
        </button>
        )}

        {/* RESET */}
        <button onClick={handleReset} disabled={loading === 'reset'}
          title="Réinitialiser la progression"
          className="btn-ghost btn-sm text-danger/60 hover:text-danger px-1">
          {loading === 'reset' ? <Spinner size={11}/> : <RotateCcw size={11}/>}
        </button>

        {/* SUP */}
        <button onClick={() => setModal('delete')} disabled={loading === 'delete'}
          title="Supprimer ce marchand de la base locale"
          className="btn-ghost btn-sm text-xs font-medium text-danger/70 hover:text-danger hover:bg-danger-dim px-2">
          {loading === 'delete' ? <Spinner size={11}/> : 'SUP'}
        </button>

      </div>

      {/* ── Modal F.PROD ─────────────────────────────────── */}
      {modal === 'fprod' && (
        <ForceProdModal
          merchant={merchant}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); onDone?.(); }}
        />
      )}

      {/* ── Modal Suppression ────────────────────────────── */}
      {modal === 'delete' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
             onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="bg-surface border border-border2 rounded-xl w-full max-w-md shadow-2xl animate-slide-up">

            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-danger/10 flex items-center justify-center">
                  <Trash2 size={15} className="text-danger"/>
                </div>
                <div className="text-sm font-semibold text-primary">Supprimer le marchand</div>
              </div>
              <button onClick={() => setModal(null)} className="text-tertiary hover:text-primary">
                <X size={16}/>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-3 bg-danger-dim border border-danger/20 rounded-lg p-4">
                <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5"/>
                <div>
                  <div className="text-sm font-semibold text-danger">Suppression définitive</div>
                  <div className="text-xs text-secondary mt-1">
                    Cette action supprime le marchand de la <strong>base locale uniquement</strong>.
                    Les données Oracle (PROD / TEST) ne sont pas affectées.
                  </div>
                </div>
              </div>

              <div className="bg-surface2 rounded-lg p-4 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-tertiary">Raison sociale</span>
                  <span className="font-medium text-primary">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tertiary">Processing ID</span>
                  <span className="font-mono text-brand">{pid}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tertiary">Statut actuel</span>
                  <span className="text-secondary">{merchant.statut || '—'}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
              <button onClick={() => setModal(null)} className="btn-ghost btn-sm">
                Annuler
              </button>
              <button onClick={handleDelete} disabled={loading === 'delete'}
                className="btn-sm bg-danger text-white hover:bg-danger/90 rounded-lg px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors">
                {loading === 'delete' ? <Spinner size={13}/> : <Trash2 size={13}/>}
                {loading === 'delete' ? 'Suppression…' : 'Confirmer la suppression'}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}

// ── Modal F.PROD ──────────────────────────────────────────
function ForceProdModal({ merchant, onClose, onDone }) {
  const [payfacId, setPayfacId] = useState('');
  const [toEmail,  setToEmail]  = useState(merchant.email_contact || '');
  const [message,  setMessage]  = useState('');
  const [sending,  setSending]  = useState(false);
  const [step,     setStep]     = useState(1);

  const { data: payfacs = [] } = useQuery({
    queryKey: ['payfacs'],
    queryFn : () => getPayfacs().then(r => r.data.payfacs || []),
    staleTime: 60_000,
  });
  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn : () => getBanks().then(r => r.data.banks || []),
    staleTime: 60_000,
  });

  const selectedPayfac = payfacs.find(p => p.id === payfacId);
  const bankOfMerchant = (() => {
    const pid = String(merchant.processing_id || '').replace(/\D/g, '');
    for (let len = 2; len >= 1; len--) {
      const code = pid.substring(0, len).padStart(2, '0');
      const b = banks.find(b => b.code === code && b.actif);
      if (b) return b;
    }
    return null;
  })();

  const handleConfirm = async () => {
    setSending(true);
    try {
      const { data } = await forceProduction({
        processingId: merchant.processing_id,
        payfacId,
        toEmail,
        bankEmail: bankOfMerchant?.email || null,
        message,
      });
      toast.success(
        `🚀 Passage en production → ${data.sentTo}${data.payfac ? " | PAYFAC: "+data.payfac : ""} | Réf: ${data.trackingRef}\n📧 2 emails envoyés`,
        { duration: 7000 }
      );
      onDone();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface border border-border2 rounded-xl w-full max-w-xl shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="text-sm font-semibold text-primary">🚀 Passage forcé en production</div>
          <button onClick={onClose} className="text-tertiary hover:text-primary"><X size={16}/></button>
        </div>

        {step === 1 && (
          <>
            <div className="px-6 py-4 space-y-4">
              {/* Infos marchand */}
              <div className="bg-surface2 rounded-lg p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-tertiary">Marchand</span>
                  <span className="font-medium text-primary">{merchant.raison_sociale}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tertiary">Processing ID</span>
                  <span className="font-mono text-brand">{merchant.processing_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tertiary">Banque détectée</span>
                  <span className={bankOfMerchant ? 'text-success font-medium' : 'text-danger'}>
                    {bankOfMerchant ? `${bankOfMerchant.name} (${bankOfMerchant.email})` : 'Non trouvée'}
                  </span>
                </div>
              </div>

              {/* PAYFAC */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  PAYFAC <span className="text-tertiary ml-1">(optionnel — sous-marchand)</span>
                </label>
                <select value={payfacId} onChange={e => setPayfacId(e.target.value)} className="input">
                  <option value="">— Sélectionner un PAYFAC —</option>
                  {payfacs.filter(p => p.actif).map(p => (
                    <option key={p.id} value={p.id}>{p.nom} ({p.identifiant})</option>
                  ))}
                </select>
                {selectedPayfac && (
                  <div className="mt-2 bg-success-dim rounded-lg px-3 py-2 text-xs space-y-1">
                    {selectedPayfac.responsable && <div><span className="text-tertiary">Responsable: </span><span className="font-medium">{selectedPayfac.responsable}</span></div>}
                    {selectedPayfac.bank_name    && <div><span className="text-tertiary">Banque: </span><span>{selectedPayfac.bank_name}</span></div>}
                    {selectedPayfac.telephone    && <div><span className="text-tertiary">Tél: </span><span className="font-mono">{selectedPayfac.telephone}</span></div>}
                  </div>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Email destinataire *</label>
                <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)} className="input"/>
              </div>

              {/* CC info */}
              <div className="text-xs bg-info-dim border border-info/20 text-info rounded-lg px-3 py-2.5">
                📋 CC automatique : supervision interne{bankOfMerchant && ` + ${bankOfMerchant.name} (${bankOfMerchant.email})`}
              </div>

              {/* Remarques */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Remarques (optionnel)</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)}
                  rows={3} className="input resize-none" placeholder="Informations complémentaires…"/>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
              <button onClick={onClose} className="btn-ghost btn-sm">Annuler</button>
              <button onClick={() => setStep(2)}
                className="btn-primary btn-sm">Suivant →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-3 bg-warning-dim border border-warning/30 rounded-lg p-4">
                <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5"/>
                <div>
                  <div className="text-sm font-semibold text-warning">Confirmation requise</div>
                  <div className="text-xs text-secondary mt-1">
                    <strong>2 emails</strong> seront envoyés à <strong>{toEmail}</strong>
                    {bankOfMerchant && <> en CC à <strong>{bankOfMerchant.name}</strong></>} :
                    <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                      <li>Demande de passage en production (banque)</li>
                      <li>Credentials PRODUCTION avec consignes anti-fraude (marchand)</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="bg-surface2 rounded-lg p-4 text-xs space-y-2">
                <div className="font-semibold text-secondary mb-2 uppercase tracking-wide text-xs">Récapitulatif</div>
                <div className="flex justify-between"><span className="text-tertiary">Marchand</span><span className="font-medium">{merchant.raison_sociale}</span></div>
                <div className="flex justify-between"><span className="text-tertiary">PAYFAC</span><span className="font-medium text-success">{selectedPayfac?.nom}</span></div>
                <div className="flex justify-between"><span className="text-tertiary">Destinataire</span><span className="font-mono">{toEmail}</span></div>
                {bankOfMerchant && <div className="flex justify-between"><span className="text-tertiary">CC Banque</span><span className="font-mono text-info">{bankOfMerchant.email}</span></div>}
                {message && <div className="flex justify-between"><span className="text-tertiary">Remarque</span><span className="italic text-secondary">{message.slice(0, 60)}{message.length > 60 ? '…' : ''}</span></div>}
              </div>

              <div className="text-xs bg-success-dim border border-success/20 text-success rounded-lg px-3 py-2.5">
                ✅ Credentials PRODUCTION générés automatiquement et inclus dans l'email marchand.
              </div>
            </div>
            <div className="flex justify-between gap-2 px-6 py-4 border-t border-border">
              <button onClick={() => setStep(1)} className="btn-ghost btn-sm">← Retour</button>
              <button onClick={handleConfirm} disabled={sending} className="btn-primary btn-sm">
                {sending ? <Spinner size={13}/> : <Send size={13}/>}
                {sending ? 'Envoi…' : 'Confirmer et envoyer (2 emails)'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
