// src/pages/AlertsPage.jsx — Gestion des règles d'alertes
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Bell, BellOff, Play, RefreshCw,
  History, Settings2, Mail, Clock, X, Save, FlaskConical,
  AlertTriangle, CheckCircle2, Loader2
} from 'lucide-react';
import toast  from 'react-hot-toast';
import clsx   from 'clsx';
import { SectionHeader, Spinner, EmptyState } from '@/components/ui';
import { getAlertRules, getAlertHistory, createAlertRule, updateAlertRule, deleteAlertRule, testAlertRule } from '@/api/alerts';
import client from '@/api/client';

// ── Constantes ─────────────────────────────────────────────
const SYSTEMES = [
  { value:'clictopay', label:'CLICTOPAY BPC',     color:'text-brand'   },
  { value:'acs',       label:'ACS 3DS2',           color:'text-info'    },
  { value:'paysmart',  label:'PAYSMART SwitchBI',  color:'text-warning' },
];

const METRIQUES = {
  clictopay: [
    { value:'declined_pct',  label:'Taux de refus (%)',          unite:'%'     },
    { value:'deposited_pct', label:'Taux de dépôt (%)',          unite:'%'     },
    { value:'started_pct',   label:'Taux démarrées (%)',         unite:'%'     },
    { value:'total_count',   label:'Nombre total transactions',   unite:'count' },
  ],
  acs: [
    { value:'srv_error_pct', label:'Taux erreurs serveur (%)',   unite:'%'     },
    { value:'abandon_pct',   label:'Taux abandons (%)',          unite:'%'     },
    { value:'areq_count',    label:'Nombre AREQ',                unite:'count' },
    { value:'ds_success_pct',label:'Taux succès DS (%)',         unite:'%'     },
    { value:'p99_ms',        label:'Latence p99 (ms)',           unite:'ms'    },
  ],
  paysmart: [
    { value:'paid_count',    label:'Nb factures payées',         unite:'count' },
    { value:'pnr_count',     label:'Nb transactions PNR',        unite:'count' },
    { value:'total_count',   label:'Nb total transactions',      unite:'count' },
    { value:'success_pct',   label:'Taux succès (%)',            unite:'%'     },
  ],
};

const OPERATEURS = ['>', '>=', '<', '<=', '='];
const NIVEAUX    = [
  { value:'danger',  label:'Danger',  cls:'badge-danger'  },
  { value:'warning', label:'Warning', cls:'badge-warning' },
  { value:'info',    label:'Info',    cls:'badge-info'    },
];

const REFRESH_OPTS = [
  { value:60,   label:'1 minute'  },
  { value:300,  label:'5 minutes' },
  { value:600,  label:'10 minutes'},
  { value:900,  label:'15 minutes'},
  { value:1800, label:'30 minutes'},
  { value:3600, label:'1 heure'   },
];

const COOLDOWN_OPTS = [
  { value:300,  label:'5 minutes' },
  { value:900,  label:'15 minutes'},
  { value:1800, label:'30 minutes'},
  { value:3600, label:'1 heure'   },
  { value:7200, label:'2 heures'  },
  { value:86400,label:'24 heures' },
];

const INIT_FORM = {
  nom:'', systeme:'clictopay', metrique:'declined_pct', operateur:'>',
  seuil:'', unite:'%', niveau:'warning', message:'',
  actif:true, notif_email:true,
  email_destinataires:'',
  refresh_interval_sec:300, cooldown_sec:3600,
};

export default function AlertsPage() {
  const qc = useQueryClient();
  const [activeTab,  setActiveTab]  = useState('rules');
  const [modal,      setModal]      = useState(null);
  const [form,       setForm]       = useState(INIT_FORM);
  const [saving,     setSaving]     = useState(false);
  const [testing,    setTesting]    = useState(null);

  // ── Requêtes ─────────────────────────────────────────────
  const rulesQuery = useQuery({
    queryKey: ['alert-rules'],
    queryFn : () => getAlertRules().then(r => r.data.rules || []),
    staleTime: 30_000,
  });

  const historyQuery = useQuery({
    queryKey: ['alert-history'],
    queryFn : () => getAlertHistory({ limit: 100 }).then(r => r.data.history || []),
    staleTime: 30_000,
    enabled : activeTab === 'history',
  });

  const rules   = rulesQuery.data  || [];
  const history = historyQuery.data || [];

  // ── Ouvrir modal ──────────────────────────────────────────
  const openAdd = () => {
    setForm(INIT_FORM);
    setModal({ mode:'add' });
  };

  const openEdit = (rule) => {
    const emails = rule.email_destinataires ? JSON.parse(rule.email_destinataires).join(', ') : '';
    setForm({
      nom:                  rule.nom,
      systeme:              rule.systeme,
      metrique:             rule.metrique,
      operateur:            rule.operateur,
      seuil:                String(rule.seuil),
      unite:                rule.unite,
      niveau:               rule.niveau,
      message:              rule.message,
      actif:                rule.actif,
      notif_email:          rule.notif_email,
      email_destinataires:  emails,
      refresh_interval_sec: rule.refresh_interval_sec,
      cooldown_sec:         rule.cooldown_sec,
    });
    setModal({ mode:'edit', rule });
  };

  // ── Mettre à jour métrique selon système ──────────────────
  const updateSysteme = (systeme) => {
    const firstMetrique = METRIQUES[systeme]?.[0];
    setForm(p => ({
      ...p, systeme,
      metrique: firstMetrique?.value || '',
      unite   : firstMetrique?.unite || '%',
    }));
  };

  const updateMetrique = (metrique) => {
    const m = METRIQUES[form.systeme]?.find(x => x.value === metrique);
    setForm(p => ({ ...p, metrique, unite: m?.unite || p.unite }));
  };

  // ── Sauvegarder ───────────────────────────────────────────
  const handleSave = async () => {
    if (!form.nom || !form.seuil || !form.message) {
      toast.error('Nom, seuil et message sont obligatoires'); return;
    }
    const emails = form.email_destinataires
      .split(/[\s,;]+/).map(e => e.trim()).filter(Boolean);

    const payload = {
      ...form,
      seuil               : parseFloat(form.seuil),
      email_destinataires : JSON.stringify(emails),
    };

    setSaving(true);
    try {
      if (modal.mode === 'add') {
        await createAlertRule(payload);
        toast.success('Règle créée');
      } else {
        await updateAlertRule(modal.rule.id, payload);
        toast.success('Règle mise à jour');
      }
      qc.invalidateQueries({ queryKey: ['alert-rules'] });
      setModal(null);
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  // ── Supprimer ─────────────────────────────────────────────
  const handleDelete = async (rule) => {
    if (!confirm(`Supprimer la règle "${rule.nom}" ?`)) return;
    try {
      await deleteAlertRule(rule.id);
      toast.success('Règle supprimée');
      qc.invalidateQueries({ queryKey: ['alert-rules'] });
    } catch(e) { toast.error(e.response?.data?.error || 'Erreur'); }
  };

  // ── Activer / désactiver ──────────────────────────────────
  const handleToggle = async (rule) => {
    try {
      await updateAlertRule(rule.id, { actif: !rule.actif });
      toast.success(rule.actif ? 'Règle désactivée' : 'Règle activée');
      qc.invalidateQueries({ queryKey: ['alert-rules'] });
    } catch(e) { toast.error(e.response?.data?.error || 'Erreur'); }
  };

  // ── Test email ────────────────────────────────────────────
  const handleTest = async (rule) => {
    setTesting(rule.id);
    try {
      const { data } = await testAlertRule(rule.id);
      toast.success(`Email test envoyé → ${data.sent_to?.join(', ')}`);
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur test');
    } finally {
      setTesting(null);
    }
  };

  // ── Helpers d'affichage ───────────────────────────────────
  const systemeLabel = (s) => SYSTEMES.find(x => x.value === s)?.label || s;
  const systemeCls   = (s) => SYSTEMES.find(x => x.value === s)?.color || '';
  const metriqueLabel= (s, m) => METRIQUES[s]?.find(x => x.value === m)?.label || m;
  const niveauCls    = (n) => NIVEAUX.find(x => x.value === n)?.cls || 'badge-neutral';
  const fmtDate      = (v) => v ? new Date(v).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
  const fmtInterval  = (s) => REFRESH_OPTS.find(x => x.value === s)?.label || `${s}s`;

  // Grouper les règles par système
  const grouped = SYSTEMES.map(sys => ({
    ...sys,
    rules: rules.filter(r => r.systeme === sys.value),
  }));

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader title="Gestion des Alertes" sub="Règles · Seuils · Notifications email">
        <button onClick={() => { rulesQuery.refetch(); }} className="btn-ghost btn-sm">
          <RefreshCw size={13} className={rulesQuery.isFetching ? 'animate-spin' : ''}/>
        </button>
        <button onClick={openAdd} className="btn-primary btn-sm">
          <Plus size={13}/> Nouvelle règle
        </button>
      </SectionHeader>

      {/* Stats rapides */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4 text-center">
          <div className="text-2xl font-semibold text-primary font-mono">{rules.length}</div>
          <div className="text-xs text-tertiary mt-0.5">Total règles</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-semibold text-success font-mono">{rules.filter(r => r.actif).length}</div>
          <div className="text-xs text-tertiary mt-0.5">Actives</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-semibold text-danger font-mono">{rules.filter(r => r.niveau === 'danger').length}</div>
          <div className="text-xs text-tertiary mt-0.5">Niveau danger</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-semibold text-info font-mono">{rules.filter(r => r.notif_email).length}</div>
          <div className="text-xs text-tertiary mt-0.5">Avec email</div>
        </div>
      </div>

      {/* Onglets */}
      <div className="flex border-b border-border">
        {[
          { key:'rules',   label:'Règles configurées', icon: Settings2 },
          { key:'sla',     label:'SLA Marchands',       icon: Clock     },
          { key:'history', label:'Historique',          icon: History   },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={clsx('flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key ? 'border-brand text-primary' : 'border-transparent text-tertiary hover:text-secondary')}>
            <tab.icon size={14}/>{tab.label}
          </button>
        ))}
      </div>

      {/* ── Onglet Règles ──────────────────────────────── */}
      {activeTab === 'rules' && (
        rulesQuery.isLoading ? (
          <div className="card p-10 flex justify-center"><Spinner size={24}/></div>
        ) : rules.length === 0 ? (
          <EmptyState title="Aucune règle configurée" message="Créez votre première règle d'alerte."/>
        ) : (
          <div className="space-y-5">
            {grouped.map(sys => sys.rules.length === 0 ? null : (
              <div key={sys.value}>
                <div className={clsx('text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2', sys.color)}>
                  <span className="w-2 h-2 rounded-full bg-current"/>
                  {sys.label} ({sys.rules.length})
                </div>
                <div className="card overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Nom</th>
                        <th>Condition</th>
                        <th>Niveau</th>
                        <th>Refresh</th>
                        <th>Email</th>
                        <th>Dernière notif</th>
                        <th>Statut</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sys.rules.map(rule => {
                        const emails = rule.email_destinataires ? JSON.parse(rule.email_destinataires) : [];
                        return (
                          <tr key={rule.id} className={clsx(!rule.actif && 'opacity-50')}>
                            <td>
                              <div className="font-medium text-primary text-sm">{rule.nom}</div>
                              <div className="text-xs text-tertiary mt-0.5 max-w-[200px] truncate">{rule.message}</div>
                            </td>
                            <td className="text-xs font-mono">
                              <span className="text-secondary">{metriqueLabel(rule.systeme, rule.metrique)}</span>
                              <span className="text-brand mx-1">{rule.operateur}</span>
                              <span className="text-primary font-semibold">{rule.seuil} {rule.unite}</span>
                            </td>
                            <td><span className={clsx('badge', niveauCls(rule.niveau))}>{rule.niveau}</span></td>
                            <td className="text-xs text-secondary">
                              <div className="flex items-center gap-1">
                                <Clock size={11}/>
                                {fmtInterval(rule.refresh_interval_sec)}
                              </div>
                            </td>
                            <td>
                              {rule.notif_email && emails.length > 0 ? (
                                <div>
                                  <span className="badge badge-success text-xs">✓ Email</span>
                                  <div className="text-xs text-tertiary mt-0.5">{emails.length} dest.</div>
                                </div>
                              ) : (
                                <span className="badge badge-neutral text-xs">Désactivé</span>
                              )}
                            </td>
                            <td className="text-xs text-tertiary">{fmtDate(rule.derniere_notif)}</td>
                            <td>
                              <span className={clsx('badge', rule.actif ? 'badge-success' : 'badge-neutral')}>
                                {rule.actif ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {/* Test email */}
                                <button onClick={() => handleTest(rule)} disabled={testing === rule.id || !emails.length}
                                  title="Tester l'envoi email" className="btn-ghost btn-sm">
                                  {testing === rule.id ? <Spinner size={11}/> : <FlaskConical size={11}/>}
                                </button>
                                {/* Modifier */}
                                <button onClick={() => openEdit(rule)} title="Modifier" className="btn-ghost btn-sm">
                                  <Pencil size={11}/>
                                </button>
                                {/* Activer/Désactiver */}
                                <button onClick={() => handleToggle(rule)}
                                  title={rule.actif ? 'Désactiver' : 'Activer'}
                                  className={clsx('btn-sm', rule.actif ? 'btn-ghost text-warning' : 'btn-ghost text-success')}>
                                  {rule.actif ? <BellOff size={11}/> : <Bell size={11}/>}
                                </button>
                                {/* Supprimer */}
                                <button onClick={() => handleDelete(rule)} title="Supprimer"
                                  className="btn-ghost btn-sm text-danger/60 hover:text-danger">
                                  <Trash2 size={11}/>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Onglet Historique ──────────────────────────── */}
      {activeTab === 'history' && (
        historyQuery.isLoading ? (
          <div className="card p-10 flex justify-center"><Spinner size={24}/></div>
        ) : history.length === 0 ? (
          <EmptyState title="Aucun historique" message="Les alertes déclenchées apparaîtront ici."/>
        ) : (
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Règle</th>
                  <th>Système</th>
                  <th>Niveau</th>
                  <th>Valeur</th>
                  <th>Seuil</th>
                  <th>Email</th>
                  <th>Destinataires</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => {
                  const emails = h.email_destinataires ? JSON.parse(h.email_destinataires) : [];
                  return (
                    <tr key={h.id}>
                      <td className="font-mono text-xs text-tertiary whitespace-nowrap">{fmtDate(h.triggered_at)}</td>
                      <td>
                        <div className="text-sm font-medium text-primary">{h.rule_nom}</div>
                        <div className="text-xs text-tertiary mt-0.5 max-w-[200px] truncate">{h.message}</div>
                      </td>
                      <td className={clsx('text-xs font-semibold', systemeCls(h.systeme))}>{systemeLabel(h.systeme)}</td>
                      <td><span className={clsx('badge', niveauCls(h.niveau))}>{h.niveau}</span></td>
                      <td className="font-mono text-xs font-semibold text-danger">{h.valeur}</td>
                      <td className="font-mono text-xs text-tertiary">{h.seuil}</td>
                      <td>
                        {h.email_envoye
                          ? <span className="badge badge-success text-xs">✓ Envoyé</span>
                          : <span className="badge badge-neutral text-xs">Non envoyé</span>}
                      </td>
                      <td className="text-xs text-tertiary max-w-[160px] truncate">
                        {emails.join(', ') || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Onglet SLA Marchands ──────────────────────── */}
      {activeTab === 'sla' && <SlaPanel qc={qc}/>}

      {/* ── Modal Ajouter/Modifier ─────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
             onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="bg-surface border border-border2 rounded-xl w-full max-w-2xl shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto">

            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-surface z-10">
              <div className="text-sm font-semibold text-primary">
                {modal.mode === 'add' ? '+ Nouvelle règle d\'alerte' : `Modifier — ${modal.rule.nom}`}
              </div>
              <button onClick={() => setModal(null)} className="text-tertiary hover:text-primary"><X size={16}/></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Ligne 1 : Nom + Système */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Nom *</label>
                  <input type="text" value={form.nom} onChange={e => setForm(p=>({...p,nom:e.target.value}))}
                    placeholder="Ex: Taux de refus élevé" className="input"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Système *</label>
                  <select value={form.systeme} onChange={e => updateSysteme(e.target.value)} className="input">
                    {SYSTEMES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Ligne 2 : Métrique + Condition */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-secondary mb-1.5">Métrique *</label>
                  <select value={form.metrique} onChange={e => updateMetrique(e.target.value)} className="input">
                    {(METRIQUES[form.systeme] || []).map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Unité</label>
                  <select value={form.unite} onChange={e => setForm(p=>({...p,unite:e.target.value}))} className="input">
                    <option value="%">%</option>
                    <option value="count">count</option>
                    <option value="ms">ms</option>
                  </select>
                </div>
              </div>

              {/* Ligne 3 : Opérateur + Seuil + Niveau */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Opérateur *</label>
                  <select value={form.operateur} onChange={e => setForm(p=>({...p,operateur:e.target.value}))} className="input font-mono">
                    {OPERATEURS.map(op => <option key={op} value={op}>{op}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Seuil *</label>
                  <div className="relative">
                    <input type="number" value={form.seuil} onChange={e => setForm(p=>({...p,seuil:e.target.value}))}
                      placeholder="40" className="input pr-10 font-mono"/>
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-tertiary">{form.unite}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Niveau *</label>
                  <select value={form.niveau} onChange={e => setForm(p=>({...p,niveau:e.target.value}))} className="input">
                    {NIVEAUX.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Message de l'alerte *</label>
                <textarea value={form.message} onChange={e => setForm(p=>({...p,message:e.target.value}))}
                  rows={2} className="input resize-none"
                  placeholder="Décrivez l'alerte qui sera affichée dans le dashboard et envoyée par email"/>
              </div>

              {/* Rafraîchissement + Cooldown */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">
                    <Clock size={11} className="inline mr-1"/>Rafraîchissement
                  </label>
                  <select value={form.refresh_interval_sec}
                    onChange={e => setForm(p=>({...p,refresh_interval_sec:parseInt(e.target.value)}))} className="input">
                    {REFRESH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <div className="text-xs text-tertiary mt-1">Fréquence de vérification du seuil</div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">
                    <Bell size={11} className="inline mr-1"/>Délai entre notifications
                  </label>
                  <select value={form.cooldown_sec}
                    onChange={e => setForm(p=>({...p,cooldown_sec:parseInt(e.target.value)}))} className="input">
                    {COOLDOWN_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <div className="text-xs text-tertiary mt-1">Anti-spam — min. entre 2 envois</div>
                </div>
              </div>

              {/* Notifications email */}
              <div className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-secondary flex items-center gap-2">
                    <Mail size={13}/> Notifications par email
                  </label>
                  <button onClick={() => setForm(p=>({...p,notif_email:!p.notif_email}))}
                    className={clsx('relative w-10 h-5 rounded-full transition-colors',
                      form.notif_email ? 'bg-brand' : 'bg-surface3')}>
                    <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',
                      form.notif_email ? 'left-5' : 'left-0.5')}/>
                  </button>
                </div>

                {form.notif_email && (
                  <div>
                    <label className="block text-xs text-tertiary mb-1.5">
                      Destinataires (séparés par virgule ou retour à la ligne)
                    </label>
                    <textarea value={form.email_destinataires}
                      onChange={e => setForm(p=>({...p,email_destinataires:e.target.value}))}
                      rows={3} className="input resize-none font-mono text-xs"
                      placeholder={"admin@clictopay.com\nequipe@clictopay.com, dsi@monetique.tn"}/>
                    <div className="text-xs text-tertiary mt-1">
                      {form.email_destinataires.split(/[\s,;]+/).filter(Boolean).length} destinataire(s)
                    </div>
                  </div>
                )}
              </div>

              {/* Statut actif */}
              <div className="flex items-center justify-between py-2 border-t border-border">
                <label className="text-xs font-medium text-secondary">Règle active</label>
                <button onClick={() => setForm(p=>({...p,actif:!p.actif}))}
                  className={clsx('relative w-10 h-5 rounded-full transition-colors',
                    form.actif ? 'bg-success' : 'bg-surface3')}>
                  <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',
                    form.actif ? 'left-5' : 'left-0.5')}/>
                </button>
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

// ══════════════════════════════════════════════════════════
// Composant SlaPanel — Onglet SLA Marchands
// ══════════════════════════════════════════════════════════
const STATUT_LABELS = {
  en_attente        : 'En attente',
  prise_en_charge   : 'Prise en charge',
  recettes_envoyees : 'Recettes envoyées',
  recettes_recues   : 'Recettes reçues',
  valide            : 'Validé',
  banque_notifiee   : 'Banque notifiée',
};

function SlaPanel({ qc }) {
  const [running,    setRunning]    = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [filterNiv,  setFilterNiv]  = useState('all');
  const [editRow,    setEditRow]    = useState(null); // { statut, delai_warning, delai_danger }
  const [toggling,   setToggling]   = useState(null); // statut en cours de toggle

  // ── Config SLA ────────────────────────────────────────
  const configQuery = useQuery({
    queryKey: ['sla-config'],
    queryFn : () => client.get('/sla/config').then(r => r.data.config || []),
    staleTime: 60_000,
  });

  // ── Dossiers en retard ────────────────────────────────
  const dossiersQuery = useQuery({
    queryKey: ['sla-dossiers', filterNiv],
    queryFn : () => client.get(`/sla/dossiers${filterNiv !== 'all' ? `?niveau=${filterNiv}` : ''}`).then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });

  // ── Historique alertes SLA ────────────────────────────
  const historyQuery = useQuery({
    queryKey: ['sla-history'],
    queryFn : () => client.get('/sla/history?limit=30').then(r => r.data.history || []),
    staleTime: 60_000,
  });

  const config   = configQuery.data   || [];
  const dossiers = dossiersQuery.data?.dossiers || [];
  const summary  = dossiersQuery.data?.summary  || { danger: 0, warning: 0, total: 0 };
  const history  = historyQuery.data  || [];

  // ── Lancer le check SLA ───────────────────────────────
  const handleCheck = async (dry = false) => {
    dry ? setDryRunning(true) : setRunning(true);
    try {
      const { data } = await client.post('/sla/check', { dry_run: dry });
      if (dry) {
        toast.success(`Dry run : ${data.total_late} dossiers en retard — ${data.details?.length || 0} seraient alertés`);
      } else {
        toast.success(`Check SLA : ${data.alerts_sent} alertes envoyées | ${data.alerts_skipped} en cooldown`);
        qc.invalidateQueries({ queryKey: ['sla-dossiers'] });
        qc.invalidateQueries({ queryKey: ['sla-history'] });
      }
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur check SLA');
    } finally {
      dry ? setDryRunning(false) : setRunning(false);
    }
  };

  // ── Toggle actif / inactif ────────────────────────────
  const handleToggleActif = async (row) => {
    setToggling(row.statut);
    const newActif = !row.actif;
    try {
      await client.patch(`/sla/config/${row.statut}`, { actif: newActif });
      toast.success(
        newActif
          ? `✅ Alertes activées — "${STATUT_LABELS[row.statut]}"`
          : `🔕 Alertes désactivées — "${STATUT_LABELS[row.statut]}"`,
        { duration: 3000 }
      );
      qc.invalidateQueries({ queryKey: ['sla-config'] });
      qc.invalidateQueries({ queryKey: ['sla-dossiers'] });
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur mise à jour');
    } finally {
      setToggling(null);
    }
  };

  // ── Sauvegarder config SLA ────────────────────────────
  const handleSaveConfig = async (row) => {
    setSaving(row.statut);
    try {
      await client.patch(`/sla/config/${row.statut}`, {
        delai_warning: parseInt(row.delai_warning),
        delai_danger : parseInt(row.delai_danger),
      });
      toast.success(`SLA "${STATUT_LABELS[row.statut]}" mis à jour`);
      qc.invalidateQueries({ queryKey: ['sla-config'] });
      qc.invalidateQueries({ queryKey: ['sla-dossiers'] });
      setEditRow(null);
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur sauvegarde');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-5">

      {/* KPIs + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="card px-4 py-3 flex items-center gap-3 flex-1 min-w-[140px]">
          <AlertTriangle size={18} className="text-danger shrink-0"/>
          <div>
            <div className="text-xl font-semibold text-primary font-mono">{summary.danger}</div>
            <div className="text-xs text-tertiary">En danger</div>
          </div>
        </div>
        <div className="card px-4 py-3 flex items-center gap-3 flex-1 min-w-[140px]">
          <Clock size={18} className="text-warning shrink-0"/>
          <div>
            <div className="text-xl font-semibold text-primary font-mono">{summary.warning}</div>
            <div className="text-xs text-tertiary">En retard</div>
          </div>
        </div>
        <div className="card px-4 py-3 flex items-center gap-3 flex-1 min-w-[140px]">
          <CheckCircle2 size={18} className="text-tertiary shrink-0"/>
          <div>
            <div className="text-xl font-semibold text-primary font-mono">{summary.total}</div>
            <div className="text-xs text-tertiary">Total en retard</div>
          </div>
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => handleCheck(true)} disabled={dryRunning}
            className="btn-ghost btn-sm text-xs">
            {dryRunning ? <Loader2 size={12} className="animate-spin"/> : <Play size={12}/>}
            Dry run
          </button>
          <button onClick={() => handleCheck(false)} disabled={running}
            className="btn-primary btn-sm text-xs">
            {running ? <Loader2 size={12} className="animate-spin"/> : <Bell size={12}/>}
            Envoyer alertes
          </button>
          <button onClick={() => { qc.invalidateQueries({queryKey:['sla-dossiers']}); }}
            className="btn-ghost btn-sm">
            <RefreshCw size={12}/>
          </button>
        </div>
      </div>

      {/* Config délais SLA */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide">
            Délais SLA par étape
          </div>
          <div className="text-xs text-tertiary">Scheduler automatique toutes les 6h</div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Étape workflow</th>
              <th className="text-center">Warning (j)</th>
              <th className="text-center">Danger (j)</th>
              <th className="text-center">Actif</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {configQuery.isLoading ? (
              <tr><td colSpan={5} className="text-center py-6"><Spinner size={20}/></td></tr>
            ) : config.map(row => {
              const isEditing = editRow?.statut === row.statut;
              const cur = isEditing ? editRow : row;
              return (
                <tr key={row.statut}>
                  <td className="font-medium">{STATUT_LABELS[row.statut] || row.statut}</td>
                  <td className="text-center">
                    {isEditing ? (
                      <input type="number" min="1" max="365"
                        value={cur.delai_warning}
                        onChange={e => setEditRow(p => ({...p, delai_warning: e.target.value}))}
                        className="input text-xs text-center w-16 mx-auto"/>
                    ) : (
                      <span className="text-warning font-mono text-xs">{row.delai_warning}j</span>
                    )}
                  </td>
                  <td className="text-center">
                    {isEditing ? (
                      <input type="number" min="1" max="365"
                        value={cur.delai_danger}
                        onChange={e => setEditRow(p => ({...p, delai_danger: e.target.value}))}
                        className="input text-xs text-center w-16 mx-auto"/>
                    ) : (
                      <span className="text-danger font-mono text-xs">{row.delai_danger}j</span>
                    )}
                  </td>
                  <td className="text-center">
                    {/* Toggle activer / désactiver */}
                    <button
                      onClick={() => !isEditing && handleToggleActif(row)}
                      disabled={toggling === row.statut || isEditing}
                      title={row.actif ? 'Cliquer pour désactiver les alertes' : 'Cliquer pour activer les alertes'}
                      className={clsx(
                        'relative inline-flex items-center rounded-full transition-colors duration-200 focus:outline-none',
                        'w-9 h-5',
                        row.actif ? 'bg-success' : 'bg-surface3',
                        isEditing ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'
                      )}
                    >
                      <span className={clsx(
                        'inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200',
                        row.actif ? 'translate-x-4' : 'translate-x-0.5'
                      )}/>
                      {toggling === row.statut && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <Loader2 size={10} className="animate-spin text-white"/>
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="text-right">
                    {isEditing ? (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleSaveConfig(editRow)} disabled={saving === row.statut}
                          className="btn-primary btn-sm text-xs">
                          {saving === row.statut ? <Spinner size={11}/> : <Save size={11}/>} Sauv.
                        </button>
                        <button onClick={() => setEditRow(null)} className="btn-ghost btn-sm">
                          <X size={11}/>
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setEditRow({ ...row })} className="btn-ghost btn-sm text-xs">
                        <Pencil size={11}/> Modifier
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dossiers en retard */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide">
            Dossiers en retard ({summary.total})
          </div>
          <div className="flex gap-1">
            {['all','warning','danger'].map(n => (
              <button key={n} onClick={() => setFilterNiv(n)}
                className={clsx('btn-sm text-xs px-2',
                  filterNiv === n ? 'btn-primary' : 'btn-ghost')}>
                {n === 'all' ? 'Tous' : n}
              </button>
            ))}
          </div>
        </div>
        {dossiersQuery.isLoading ? (
          <div className="py-8 flex justify-center"><Spinner size={20}/></div>
        ) : dossiers.length === 0 ? (
          <div className="py-8 text-center text-xs text-success">
            ✅ Aucun dossier en retard
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Marchand</th>
                  <th>Processing ID</th>
                  <th>Étape actuelle</th>
                  <th className="text-center">Jours dans l'étape</th>
                  <th className="text-center">Niveau</th>
                  <th>Dernière alerte</th>
                </tr>
              </thead>
              <tbody>
                {dossiers.map(d => (
                  <tr key={d.processing_id}>
                    <td className="font-medium truncate max-w-[160px]" title={d.raison_sociale}>
                      {d.raison_sociale}
                    </td>
                    <td className="font-mono text-xs text-brand">{d.processing_id}</td>
                    <td className="text-xs">{STATUT_LABELS[d.statut] || d.statut}</td>
                    <td className="text-center">
                      <span className={clsx('font-mono text-sm font-bold',
                        d.niveau_sla === 'danger' ? 'text-danger' : 'text-warning')}>
                        {d.jours_etape}j
                      </span>
                    </td>
                    <td className="text-center">
                      <span className={clsx('badge text-xs',
                        d.niveau_sla === 'danger' ? 'badge-danger' : 'badge-warning')}>
                        {d.niveau_sla}
                      </span>
                    </td>
                    <td className="text-xs text-tertiary">
                      {d.sla_derniere_alerte
                        ? new Date(d.sla_derniere_alerte).toLocaleDateString('fr-FR')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historique alertes SLA */}
      {history.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide">
            Historique alertes SLA ({history.length})
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Marchand</th>
                  <th>Étape</th>
                  <th className="text-center">Jours</th>
                  <th className="text-center">Niveau</th>
                  <th className="text-center">Email</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td className="text-xs font-medium truncate max-w-[140px]">{h.raison_sociale}</td>
                    <td className="text-xs text-tertiary">{STATUT_LABELS[h.statut] || h.statut}</td>
                    <td className="text-center font-mono text-xs">{h.jours_en_attente}j</td>
                    <td className="text-center">
                      <span className={clsx('badge text-xs',
                        h.niveau === 'danger' ? 'badge-danger' : 'badge-warning')}>
                        {h.niveau}
                      </span>
                    </td>
                    <td className="text-center">
                      {h.email_envoye
                        ? <span className="text-success text-xs">✓</span>
                        : <span className="text-tertiary text-xs">—</span>}
                    </td>
                    <td className="text-xs text-tertiary whitespace-nowrap">
                      {new Date(h.triggered_at).toLocaleDateString('fr-FR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
