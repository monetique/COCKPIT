// src/pages/VersionPage.jsx
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import client from '@/api/client';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Tag, Clock, Server, GitCommit, ChevronDown, ChevronUp, Plus, Edit2, Check, X } from 'lucide-react';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

function ChangelogView({ text }) {
  if (!text) return <span className="text-tertiary text-xs italic">Aucun changelog</span>;
  // Rendu markdown simplifié
  const lines = text.split('\n');
  return (
    <div className="text-sm text-secondary space-y-1">
      {lines.map((l, i) => {
        if (l.startsWith('## '))  return <h3 key={i} className="font-bold text-primary text-sm mt-2">{l.replace('## ','')}</h3>;
        if (l.startsWith('### ')) return <h4 key={i} className="font-semibold text-primary text-xs mt-1">{l.replace('### ','')}</h4>;
        if (l.startsWith('- '))   return <div key={i} className="flex gap-1.5"><span className="text-primary mt-0.5">·</span><span>{l.slice(2)}</span></div>;
        if (l === '')              return <div key={i} className="h-1"/>;
        return <div key={i}>{l}</div>;
      })}
    </div>
  );
}

export default function VersionPage() {
  const qc = useQueryClient();
  const [expanded,    setExpanded]    = useState(null);
  const [editId,      setEditId]      = useState(null);
  const [editText,    setEditText]    = useState('');
  const [showNew,     setShowNew]     = useState(false);
  const [newVersion,  setNewVersion]  = useState('');
  const [newChangelog,setNewChangelog]= useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['versions'],
    queryFn : () => client.get('/version').then(r => r.data),
  });

  const mutEdit = useMutation({
    mutationFn: ({ id, changelog }) => client.patch(`/version/${id}/changelog`, { changelog }),
    onSuccess : () => { toast.success('Changelog mis à jour'); qc.invalidateQueries(['versions']); setEditId(null); },
    onError   : () => toast.error('Erreur mise à jour'),
  });

  const mutNew = useMutation({
    mutationFn: ({ version, changelog }) => client.post('/version', { version, changelog }),
    onSuccess : () => { toast.success('Version créée'); qc.invalidateQueries(['versions']); setShowNew(false); setNewVersion(''); setNewChangelog(''); },
    onError   : (e) => toast.error(e.response?.data?.error || 'Erreur création'),
  });

  const versions = data?.versions || [];

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-primary flex items-center gap-2">
            <Tag size={18}/> Versions de SMT Cockpit
          </h1>
          <p className="text-xs text-tertiary mt-0.5">
            Historique des déploiements — enregistrement automatique au démarrage
          </p>
        </div>
        <button onClick={() => setShowNew(v => !v)}
          className="btn-primary btn-sm flex items-center gap-1.5">
          <Plus size={13}/> Nouvelle version
        </button>
      </div>

      {/* Formulaire nouvelle version */}
      {showNew && (
        <div className="card p-4 space-y-3 border-l-4 border-primary">
          <div className="text-sm font-semibold text-primary">Enregistrer une version manuellement</div>
          <div className="flex gap-3">
            <div className="w-36">
              <label className="block text-xs text-secondary mb-1">Numéro de version</label>
              <input value={newVersion} onChange={e=>setNewVersion(e.target.value)}
                placeholder="ex: 2.1.0" className="input-field text-sm w-full"/>
            </div>
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Changelog (Markdown)</label>
            <textarea value={newChangelog} onChange={e=>setNewChangelog(e.target.value)}
              rows={6} placeholder="## v2.1.0&#10;&#10;### Nouvelles fonctionnalités&#10;- ..."
              className="input-field text-sm w-full font-mono text-xs"/>
          </div>
          <div className="flex gap-2">
            <button onClick={() => mutNew.mutate({ version:newVersion, changelog:newChangelog })}
              disabled={!newVersion || mutNew.isPending}
              className="btn-primary btn-sm flex items-center gap-1.5">
              <Check size={13}/> Enregistrer
            </button>
            <button onClick={() => setShowNew(false)} className="btn-ghost btn-sm">
              <X size={13}/>
            </button>
          </div>
        </div>
      )}

      {/* Liste des versions */}
      {isLoading ? (
        <div className="text-center text-secondary text-sm py-8">Chargement…</div>
      ) : (
        <div className="space-y-2">
          {versions.map(v => (
            <div key={v.id} className={clsx(
              'card overflow-hidden transition-all',
              v.actif && 'border-l-4 border-primary'
            )}>
              {/* En-tête de version */}
              <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-hover"
                onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                <div className="flex items-center gap-3">
                  {/* Badge version */}
                  <span className={clsx(
                    'font-mono text-sm font-bold px-2.5 py-0.5 rounded-full',
                    v.actif
                      ? 'bg-primary text-white'
                      : 'bg-surface text-secondary border border-border'
                  )}>
                    v{v.version}
                  </span>
                  {v.actif && (
                    <span className="badge badge-success text-xs">Version active</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-tertiary">
                  <span className="flex items-center gap-1">
                    <Clock size={11}/> {fmtDate(v.deployed_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Server size={11}/> {v.deployed_by || '—'}
                  </span>
                  {v.git_commit && (
                    <span className="flex items-center gap-1 font-mono">
                      <GitCommit size={11}/> {v.git_commit.slice(0,7)}
                    </span>
                  )}
                  {expanded === v.id
                    ? <ChevronUp size={14}/>
                    : <ChevronDown size={14}/>}
                </div>
              </div>

              {/* Changelog déplié */}
              {expanded === v.id && (
                <div className="border-t border-border px-4 py-3 space-y-3">
                  {editId === v.id ? (
                    <div className="space-y-2">
                      <textarea value={editText} onChange={e=>setEditText(e.target.value)}
                        rows={8} className="input-field text-xs w-full font-mono"/>
                      <div className="flex gap-2">
                        <button onClick={() => mutEdit.mutate({ id:v.id, changelog:editText })}
                          disabled={mutEdit.isPending}
                          className="btn-primary btn-sm flex items-center gap-1">
                          <Check size={12}/> Sauvegarder
                        </button>
                        <button onClick={() => setEditId(null)} className="btn-ghost btn-sm">
                          <X size={12}/> Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <ChangelogView text={v.changelog}/>
                      <button onClick={() => { setEditId(v.id); setEditText(v.changelog||''); }}
                        className="btn-ghost btn-sm flex items-center gap-1 text-xs mt-2">
                        <Edit2 size={11}/> Modifier le changelog
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
