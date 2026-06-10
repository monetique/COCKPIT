// src/pages/BanksPage.jsx
import { useState }           from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Power, RefreshCw, Landmark, X, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx  from 'clsx';
import { SectionHeader, Spinner, EmptyState } from '@/components/ui';
import { getBanks, createBank, updateBank, deleteBank } from '@/api/banks';
import useAuthStore from '@/store/authStore';

export default function BanksPage() {
  const qc      = useQueryClient();
  const isAdmin = useAuthStore(s => s.isAdmin());

  const [modal,   setModal]   = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [form,    setForm]    = useState({ code:'', name:'', email:'', email_cc:'' });
  const [errors,  setErrors]  = useState({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['banks'],
    queryFn : () => getBanks().then(r => r.data.banks || []),
    staleTime: 60_000,
  });

  const banks = data || [];

  // ── Ouvrir modal ────────────────────────────────────────
  const openAdd = () => {
    setForm({ code:'', name:'', email:'', email_cc:'' });
    setErrors({});
    setModal({ mode:'add' });
  };

  const openEdit = (bank) => {
    setForm({ code: bank.code, name: bank.name, email: bank.email || '', email_cc: bank.email_cc || '' });
    setErrors({});
    setModal({ mode:'edit', bank });
  };

  // ── Valider le formulaire ────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.code.trim())  e.code  = 'Code requis (1-2 chiffres)';
    else if (!/^\d{1,2}$/.test(form.code.trim())) e.code = 'Code : 1 ou 2 chiffres uniquement';
    if (!form.name.trim())  e.name  = 'Nom requis';
    if (!form.email.trim()) e.email = 'Email requis';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Email invalide';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Sauvegarder ─────────────────────────────────────────
  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (modal.mode === 'add') {
        await createBank({ code: form.code.trim().padStart(2,'0'), name: form.name.trim(), email: form.email.trim(), email_cc: form.email_cc.trim() || null });
        toast.success('Banque créée');
      } else {
        await updateBank(modal.bank.id, { name: form.name.trim(), email: form.email.trim(), email_cc: form.email_cc.trim() || null });
        toast.success('Banque mise à jour');
      }
      qc.invalidateQueries({ queryKey: ['banks'] });
      setModal(null);
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  // ── Activer / Désactiver ─────────────────────────────────
  const handleToggle = async (bank) => {
    try {
      if (bank.actif) {
        await deleteBank(bank.id);
        toast.success(`${bank.name} désactivée`);
      } else {
        await updateBank(bank.id, { actif: true });
        toast.success(`${bank.name} réactivée`);
      }
      qc.invalidateQueries({ queryKey: ['banks'] });
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur');
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader title="Gestion des Banques" sub="Référentiel des banques acquéreurs · Notifications workflow">
        <button onClick={() => refetch()} className="btn-ghost btn-sm">
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''}/>
        </button>
        {isAdmin && (
          <button onClick={openAdd} className="btn-primary btn-sm">
            <Plus size={13}/> Ajouter une banque
          </button>
        )}
      </SectionHeader>

      {/* Stats rapides */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <div className="text-2xl font-semibold text-primary font-mono">{banks.length}</div>
          <div className="text-xs text-tertiary mt-0.5">Total</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-semibold text-success font-mono">{banks.filter(b => b.actif).length}</div>
          <div className="text-xs text-tertiary mt-0.5">Actives</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-semibold text-danger font-mono">{banks.filter(b => !b.actif).length}</div>
          <div className="text-xs text-tertiary mt-0.5">Inactives</div>
        </div>
      </div>

      {/* Tableau */}
      {isLoading ? (
        <div className="card p-8 flex justify-center"><Spinner size={24}/></div>
      ) : banks.length === 0 ? (
        <EmptyState title="Aucune banque" message="Ajoutez la première banque acquéreur."/>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Code</th>
                <th>Nom de la banque</th>
                <th>Email notification</th>
                <th>Emails CC</th>
                <th style={{ width: 90 }}>Statut</th>
                <th style={{ width: 80 }}>Marchands</th>
                {isAdmin && <th className="text-right" style={{ width: 120 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {banks.map(bank => (
                <tr key={bank.id} className={clsx(!bank.actif && 'opacity-50')}>
                  <td className="font-mono text-sm font-bold text-brand">{bank.code}</td>
                  <td className="font-medium text-primary">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-surface3 flex items-center justify-center shrink-0">
                        <Landmark size={13} className="text-tertiary"/>
                      </div>
                      {bank.name}
                    </div>
                  </td>
                  <td className="text-xs text-secondary font-mono">{bank.email || '—'}</td>
                  <td className="text-xs text-tertiary">
                    {bank.email_cc
                      ? bank.email_cc.split(';').filter(Boolean).map((e,i) => (
                          <div key={i} className="font-mono">{e.trim()}</div>
                        ))
                      : <span className="opacity-40">—</span>
                    }
                  </td>
                  <td>
                    <span className={clsx('badge', bank.actif ? 'badge-success' : 'badge-neutral')}>
                      {bank.actif ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-tertiary">
                    {bank.merchants_count != null ? bank.merchants_count : '—'}
                  </td>
                  {isAdmin && (
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(bank)} className="btn-ghost btn-sm" title="Modifier">
                          <Pencil size={12}/>
                        </button>
                        <button
                          onClick={() => handleToggle(bank)}
                          className={clsx('btn-sm', bank.actif ? 'btn-ghost text-danger/70 hover:text-danger' : 'btn-ghost text-success/70 hover:text-success')}
                          title={bank.actif ? 'Désactiver' : 'Réactiver'}
                        >
                          <Power size={12}/>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Ajouter / Modifier */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
             onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="bg-surface border border-border2 rounded-xl w-full max-w-md shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="text-sm font-semibold text-primary">
                {modal.mode === 'add' ? '+ Nouvelle banque' : `Modifier — ${modal.bank.name}`}
              </div>
              <button onClick={() => setModal(null)} className="text-tertiary hover:text-primary">
                <X size={16}/>
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Code */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  Code banque <span className="text-danger">*</span>
                  <span className="text-tertiary ml-1">(1-2 chiffres, ex: 07)</span>
                </label>
                <input
                  type="text"
                  value={form.code}
                  onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                  placeholder="07"
                  maxLength={2}
                  disabled={modal.mode === 'edit'}
                  className={clsx('input font-mono', modal.mode === 'edit' && 'opacity-50 cursor-not-allowed', errors.code && 'border-danger')}
                />
                {errors.code && <div className="text-xs text-danger mt-1">{errors.code}</div>}
              </div>

              {/* Nom */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  Nom de la banque <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Banque Nationale Agricole"
                  className={clsx('input', errors.name && 'border-danger')}
                />
                {errors.name && <div className="text-xs text-danger mt-1">{errors.name}</div>}
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  Email notification <span className="text-danger">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="ecommerce@bna.tn"
                  className={clsx('input', errors.email && 'border-danger')}
                />
                {errors.email && <div className="text-xs text-danger mt-1">{errors.email}</div>}
              </div>

              {/* Email CC supplémentaires */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  Emails CC supplémentaires
                  <span className="ml-1.5 text-tertiary font-normal">(optionnel — séparés par ;)</span>
                </label>
                <input
                  type="text"
                  value={form.email_cc}
                  onChange={e => setForm(p => ({ ...p, email_cc: e.target.value }))}
                  placeholder="responsable@bna.tn;chef@bna.tn"
                  className="input"
                />
                <div className="text-xs text-tertiary mt-1">
                  Ces adresses seront ajoutées en CC sur tous les emails envoyés à cette banque.
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
              <button onClick={() => setModal(null)} className="btn-ghost btn-sm">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
                {saving ? <Spinner size={13}/> : <Save size={13}/>}
                {saving ? 'Sauvegarde…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
