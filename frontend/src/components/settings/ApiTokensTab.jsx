// src/components/settings/ApiTokensTab.jsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Power, Trash2, Activity, AlertTriangle,
         Check, X, Save, Key } from 'lucide-react';
import toast  from 'react-hot-toast';
import clsx   from 'clsx';
import { Spinner, EmptyState } from '@/components/ui';
import { getTokens, createToken, updateToken, revokeToken, getTokenLogs } from '@/api/api-tokens';

const INIT_FORM = { nom:'', description:'', auto_onboard:true, expires_at:'' };

export default function ApiTokensTab() {
  const qc = useQueryClient();
  const [modal,    setModal]    = useState(false);
  const [form,     setForm]     = useState(INIT_FORM);
  const [saving,   setSaving]   = useState(false);
  const [newToken, setNewToken] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [copied,   setCopied]   = useState(false);

  const tokensQ = useQuery({ queryKey:['api-tokens'],     queryFn:()=>getTokens().then(r=>r.data.tokens||[]),   staleTime:30_000 });
  const logsQ   = useQuery({ queryKey:['api-token-logs'], queryFn:()=>getTokenLogs().then(r=>r.data.logs||[]),  staleTime:30_000, enabled:showLogs });

  const tokens = tokensQ.data || [];
  const logs   = logsQ.data  || [];

  const handleCreate = async () => {
    if (!form.nom.trim()) { toast.error('Nom requis'); return; }
    setSaving(true);
    try {
      const { data } = await createToken({
        nom: form.nom.trim(), description: form.description || null,
        auto_onboard: form.auto_onboard, expires_at: form.expires_at || null,
      });
      setNewToken(data.token);
      qc.invalidateQueries({ queryKey:['api-tokens'] });
      setModal(false);
      setForm(INIT_FORM);
    } catch(e) { toast.error(e.response?.data?.error || 'Erreur'); }
    finally { setSaving(false); }
  };

  const copyToken = (tok) => {
    navigator.clipboard?.writeText(tok);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    toast.success('Token copié dans le presse-papier');
  };

  const handleRevoke = async (t) => {
    if (!confirm(`Révoquer "${t.nom}" ? Action irréversible.`)) return;
    try { await revokeToken(t.id); toast.success('Token révoqué'); qc.invalidateQueries({queryKey:['api-tokens']}); }
    catch(e) { toast.error(e.response?.data?.error||'Erreur'); }
  };

  const handleToggle = async (t) => {
    try { await updateToken(t.id,{actif:!t.actif}); qc.invalidateQueries({queryKey:['api-tokens']}); }
    catch { toast.error('Erreur'); }
  };

  const fmtDate = v => v ? new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-tertiary">{tokens.length} token(s)</div>
        <div className="flex gap-2">
          <button onClick={()=>setShowLogs(v=>!v)} className={clsx('btn-ghost btn-sm',showLogs&&'bg-surface3')}>
            <Activity size={13}/> Logs
          </button>
          <button onClick={()=>{setForm(INIT_FORM);setModal(true);}} className="btn-primary btn-sm">
            <Plus size={13}/> Nouveau token
          </button>
        </div>
      </div>

      {/* Bannière nouveau token */}
      {newToken && (
        <div className="card p-4 border border-warning/50 bg-warning-dim space-y-3">
          <div className="flex items-center gap-2 text-warning font-semibold text-sm">
            <AlertTriangle size={15}/>
            Copiez ce token maintenant — il ne sera plus visible !
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-surface3 rounded px-3 py-2 text-xs font-mono text-primary break-all">
              {newToken}
            </code>
            <button onClick={()=>copyToken(newToken)}
              className={clsx('btn-sm shrink-0', copied?'btn-primary':'btn-ghost')}>
              {copied ? <Check size={13}/> : <Copy size={13}/>}
              {copied ? 'Copié !' : 'Copier'}
            </button>
          </div>
          <button onClick={()=>setNewToken(null)} className="btn-ghost btn-sm text-xs">
            <X size={11}/> Fermer (j'ai copié le token)
          </button>
        </div>
      )}

      {/* Tableau tokens */}
      {tokensQ.isLoading ? <div className="card p-8 flex justify-center"><Spinner size={24}/></div>
      : tokens.length === 0 ? <EmptyState title="Aucun token" message="Créez un token pour l'intégration externe."/>
      : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Préfixe</th>
                <th>Auto-onboard</th>
                <th className="text-right">Appels</th>
                <th>Dernière util.</th>
                <th>Expiration</th>
                <th>Statut</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id} className={clsx(!t.actif && 'opacity-50')}>
                  <td>
                    <div className="font-medium text-primary">{t.nom}</div>
                    {t.description && <div className="text-xs text-tertiary">{t.description}</div>}
                  </td>
                  <td><code className="text-xs font-mono bg-surface3 px-2 py-0.5 rounded text-brand">{t.token_prefix}…</code></td>
                  <td><span className={clsx('badge text-xs', t.auto_onboard?'badge-success':'badge-neutral')}>{t.auto_onboard?'✓ Actif':'Manuel'}</span></td>
                  <td className="text-right font-mono text-xs">{(t.nb_appels||0).toLocaleString('fr-FR')}</td>
                  <td className="text-xs text-tertiary">{fmtDate(t.derniere_util)}</td>
                  <td className="text-xs">
                    {t.expires_at
                      ? <span className={new Date(t.expires_at)<new Date()?'text-danger':'text-secondary'}>{fmtDate(t.expires_at)}</span>
                      : <span className="text-tertiary">Permanent</span>}
                  </td>
                  <td><span className={clsx('badge text-xs',t.actif?'badge-success':'badge-danger')}>{t.actif?'Actif':'Révoqué'}</span></td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={()=>handleToggle(t)} className={clsx('btn-ghost btn-sm',t.actif?'text-warning':'text-success')}>
                        <Power size={12}/>
                      </button>
                      <button onClick={()=>handleRevoke(t)} className="btn-ghost btn-sm text-danger/60 hover:text-danger">
                        <Trash2 size={12}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Logs */}
      {showLogs && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide">
            Journal des appels API (100 derniers)
          </div>
          {logsQ.isLoading ? <div className="p-4 flex justify-center"><Spinner size={16}/></div>
          : logs.length === 0 ? <div className="p-4 text-xs text-tertiary text-center">Aucun appel</div>
          : (
            <table className="data-table">
              <thead><tr><th>Date</th><th>Token</th><th>Statut</th><th>IP</th><th>Résumé</th></tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td className="font-mono text-xs text-tertiary whitespace-nowrap">{fmtDate(l.created_at)}</td>
                    <td className="text-xs text-secondary">{l.token_nom||'—'}</td>
                    <td><span className={clsx('badge text-xs',l.status_code<300?'badge-success':l.status_code<500?'badge-warning':'badge-danger')}>{l.status_code}</span></td>
                    <td className="font-mono text-xs text-tertiary">{l.ip}</td>
                    <td className="text-xs text-tertiary max-w-[220px] truncate">{l.body_summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Documentation */}
      <div className="card p-5 space-y-3">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide">
          Documentation API v1 — Ajout marchand
        </div>
        <div className="text-xs text-secondary">
          <code className="bg-surface3 px-1.5 py-0.5 rounded font-mono text-brand">POST /api/v1/affiliates</code>
          <span className="ml-2 text-tertiary">— Header : <code className="bg-surface3 px-1 rounded">X-API-Key: smtck_…</code></span>
        </div>
        <pre className="bg-surface3 rounded-lg p-3 text-xs font-mono text-secondary overflow-x-auto leading-relaxed">{`curl -X POST "https://votre-domaine/api/v1/affiliates" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: smtck_VOTRE_TOKEN" \\
  -d '{
    "merchant_code":   "2490002546",
    "company_name":    "Ma Société SARL",
    "email":           "contact@exemple.com",
    "technical_email": "tech@exemple.com"
  }'`}</pre>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="font-semibold text-secondary mb-2">Obligatoires</div>
            {['merchant_code','company_name','email','technical_email'].map(f=>(
              <div key={f} className="font-mono text-brand text-xs">{f}</div>
            ))}
          </div>
          <div>
            <div className="font-semibold text-secondary mb-2">Optionnels</div>
            {['numero_terminal','trade_name','address','city','phone','mcc_code','website','iban'].map(f=>(
              <div key={f} className="font-mono text-tertiary text-xs">{f}</div>
            ))}
          </div>
          <div>
            <div className="font-semibold text-secondary mb-2">Statuts retournés</div>
            <div className="space-y-1.5">
              <div><span className="badge badge-neutral text-xs">en_attente</span><div className="text-tertiary text-xs mt-0.5">Nouveau → auto-onboard</div></div>
              <div><span className="badge badge-warning text-xs">recettes_envoyees</span><div className="text-tertiary text-xs mt-0.5">Oracle TEST existant</div></div>
              <div><span className="badge badge-success text-xs">en_production</span><div className="text-tertiary text-xs mt-0.5">Oracle PROD existant</div></div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal création */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
             onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="bg-surface border border-border2 rounded-xl w-full max-w-md shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="text-sm font-semibold text-primary flex items-center gap-2"><Key size={14}/> Nouveau token API</div>
              <button onClick={()=>setModal(false)} className="text-tertiary hover:text-primary"><X size={16}/></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Nom de l'application *</label>
                <input type="text" value={form.nom} onChange={e=>setForm(p=>({...p,nom:e.target.value}))}
                  placeholder="Système RH, Portail Web…" className="input"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Description</label>
                <input type="text" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))}
                  placeholder="Usage du token…" className="input"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Expiration (optionnelle)</label>
                <input type="datetime-local" value={form.expires_at} onChange={e=>setForm(p=>({...p,expires_at:e.target.value}))} className="input"/>
                <div className="text-xs text-tertiary mt-1">Laisser vide pour un token permanent.</div>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-border">
                <div>
                  <div className="text-xs font-medium text-secondary">Prise en charge automatique</div>
                  <div className="text-xs text-tertiary">Email + workflow déclenchés à chaque ajout</div>
                </div>
                <button onClick={()=>setForm(p=>({...p,auto_onboard:!p.auto_onboard}))}
                  className={clsx('relative w-10 h-5 rounded-full transition-colors',form.auto_onboard?'bg-brand':'bg-surface3')}>
                  <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',form.auto_onboard?'left-5':'left-0.5')}/>
                </button>
              </div>
              <div className="text-xs bg-info-dim border border-info/20 text-info rounded-lg px-3 py-2.5">
                ℹ️ Le token ne sera visible qu'une seule fois après génération.
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
              <button onClick={()=>setModal(false)} className="btn-ghost btn-sm">Annuler</button>
              <button onClick={handleCreate} disabled={saving} className="btn-primary btn-sm">
                {saving?<Spinner size={13}/>:<Key size={13}/>}
                {saving?'Génération…':'Générer le token'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
