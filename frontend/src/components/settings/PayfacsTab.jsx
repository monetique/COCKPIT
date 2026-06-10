// src/components/settings/PayfacsTab.jsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Power, X, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx  from 'clsx';
import { Spinner, EmptyState } from '@/components/ui';
import { getPayfacs, createPayfac, updatePayfac, deletePayfac } from '@/api/payfacs';
import { getBanks } from '@/api/banks';

const INIT = { identifiant:'', nom:'', responsable:'', webmaster:'', bank_id:'', telephone:'', actif:true };

export default function PayfacsTab() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [form,  setForm]  = useState(INIT);
  const [saving,setSaving]= useState(false);

  const { data:payfacs=[], isLoading } = useQuery({
    queryKey:['payfacs'], queryFn:()=>getPayfacs().then(r=>r.data.payfacs||[]), staleTime:30_000 });
  const { data:banks=[] } = useQuery({
    queryKey:['banks'], queryFn:()=>getBanks().then(r=>r.data.banks||[]), staleTime:60_000 });

  const openAdd  = () => { setForm(INIT); setModal({ mode:'add' }); };
  const openEdit = (p) => {
    setForm({ identifiant:p.identifiant, nom:p.nom, responsable:p.responsable||'',
      webmaster:p.webmaster||'', bank_id:p.bank_id||'', telephone:p.telephone||'', actif:p.actif });
    setModal({ mode:'edit', payfac:p });
  };

  const handleSave = async () => {
    if (!form.identifiant || !form.nom) { toast.error('Identifiant et nom requis'); return; }
    setSaving(true);
    try {
      const payload = { ...form, bank_id: form.bank_id || null };
      if (modal.mode==='add') { await createPayfac(payload); toast.success('PAYFAC créé'); }
      else { await updatePayfac(modal.payfac.id, payload); toast.success('PAYFAC mis à jour'); }
      qc.invalidateQueries({ queryKey:['payfacs'] });
      setModal(null);
    } catch(e) { toast.error(e.response?.data?.error||'Erreur'); }
    finally { setSaving(false); }
  };

  const handleToggle = async (p) => {
    try {
      await updatePayfac(p.id, { actif:!p.actif });
      qc.invalidateQueries({ queryKey:['payfacs'] });
      toast.success(p.actif ? `${p.nom} désactivé` : `${p.nom} réactivé`);
    } catch { toast.error('Erreur'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-tertiary">{payfacs.length} PAYFAC(s)</div>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={13}/> Nouveau PAYFAC</button>
      </div>

      {isLoading ? <div className="card p-8 flex justify-center"><Spinner size={24}/></div>
      : payfacs.length===0 ? <EmptyState title="Aucun PAYFAC" message="Ajoutez un premier PAYFAC."/>
      : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr>
              <th>Identifiant</th><th>Nom</th><th>Responsable</th>
              <th>Banque</th><th>Téléphone</th><th>Statut</th>
              <th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {payfacs.map(p => (
                <tr key={p.id} className={clsx(!p.actif && 'opacity-50')}>
                  <td className="font-mono text-xs text-brand">{p.identifiant}</td>
                  <td className="font-medium text-primary">{p.nom}</td>
                  <td className="text-xs text-secondary">{p.responsable||'—'}</td>
                  <td className="text-xs text-secondary">{p.bank_name||'—'}</td>
                  <td className="font-mono text-xs text-tertiary">{p.telephone||'—'}</td>
                  <td><span className={clsx('badge text-xs', p.actif?'badge-success':'badge-neutral')}>{p.actif?'Actif':'Inactif'}</span></td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={()=>openEdit(p)} className="btn-ghost btn-sm"><Pencil size={11}/></button>
                      <button onClick={()=>handleToggle(p)}
                        className={clsx('btn-ghost btn-sm', p.actif?'text-warning':'text-success')}>
                        <Power size={11}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
             onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="bg-surface border border-border2 rounded-xl w-full max-w-lg shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="text-sm font-semibold text-primary">
                {modal.mode==='add' ? '+ Nouveau PAYFAC' : `Modifier — ${modal.payfac.nom}`}
              </div>
              <button onClick={()=>setModal(null)} className="text-tertiary hover:text-primary"><X size={16}/></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Identifiant *</label>
                  <input type="text" value={form.identifiant} onChange={e=>setForm(p=>({...p,identifiant:e.target.value}))}
                    disabled={modal.mode==='edit'} className={clsx('input font-mono', modal.mode==='edit'&&'opacity-50')}/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Nom *</label>
                  <input type="text" value={form.nom} onChange={e=>setForm(p=>({...p,nom:e.target.value}))} className="input"/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Responsable</label>
                  <input type="text" value={form.responsable} onChange={e=>setForm(p=>({...p,responsable:e.target.value}))} className="input"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Téléphone</label>
                  <input type="text" value={form.telephone} onChange={e=>setForm(p=>({...p,telephone:e.target.value}))} className="input"/>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Webmaster / Email</label>
                <input type="email" value={form.webmaster} onChange={e=>setForm(p=>({...p,webmaster:e.target.value}))}
                  placeholder="webmaster@payfac.com" className="input"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Banque acquéreur</label>
                <select value={form.bank_id} onChange={e=>setForm(p=>({...p,bank_id:e.target.value}))} className="input">
                  <option value="">— Sélectionner une banque —</option>
                  {banks.filter(b=>b.actif).map(b => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-border">
                <span className="text-xs font-medium text-secondary">Actif</span>
                <button onClick={()=>setForm(p=>({...p,actif:!p.actif}))}
                  className={clsx('relative w-10 h-5 rounded-full transition-colors',form.actif?'bg-success':'bg-surface3')}>
                  <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',form.actif?'left-5':'left-0.5')}/>
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
              <button onClick={()=>setModal(null)} className="btn-ghost btn-sm">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
                {saving?<Spinner size={13}/>:<Save size={13}/>}
                {saving?'Sauvegarde…':'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
