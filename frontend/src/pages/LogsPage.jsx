// src/pages/LogsPage.jsx — Consultation des logs système
import { useState, useEffect } from 'react';
import { useQuery }   from '@tanstack/react-query';
import { SectionHeader, Spinner } from '@/components/ui';
import { Shield, AlertTriangle, Info, Activity, RefreshCw, Download, Search, Filter } from 'lucide-react';
import client from '@/api/client';
import clsx   from 'clsx';

// ── API ───────────────────────────────────────────────────
const getLogs  = (p) => client.get('/logs',        { params: p }).then(r => r.data);
const getStats = ()  => client.get('/logs/stats').then(r => r.data);
const getFiles = ()  => client.get('/logs/files').then(r => r.data);

// ── Config niveaux ────────────────────────────────────────
const LEVEL_CFG = {
  error: { cls: 'text-danger  bg-danger-dim  border-danger/20',  icon: '🔴', label: 'ERROR' },
  warn : { cls: 'text-warning bg-warning-dim border-warning/20', icon: '🟡', label: 'WARN'  },
  info : { cls: 'text-info    bg-info-dim    border-info/20',    icon: '🔵', label: 'INFO'  },
  http : { cls: 'text-secondary bg-surface2  border-border',     icon: '⚪', label: 'HTTP'  },
  debug: { cls: 'text-tertiary bg-surface    border-border',     icon: '⚫', label: 'DEBUG' },
};

const TYPE_TABS = [
  { key: 'all',    label: 'Tous',     icon: Activity },
  { key: 'action', label: 'Actions',  icon: Shield   },
  { key: 'error',  label: 'Erreurs',  icon: AlertTriangle },
  { key: 'http',   label: 'HTTP',     icon: Info     },
];

function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString('fr-FR', { dateStyle:'short', timeStyle:'medium' }); }
  catch { return String(v); }
}

export default function LogsPage() {
  const [type,   setType]   = useState('all');
  const [level,  setLevel]  = useState('');
  const [user,   setUser]   = useState('');
  const [action, setAction] = useState('');
  const [q,      setQ]      = useState('');
  const [from,   setFrom]   = useState('');
  const [to,     setTo]     = useState('');
  const [limit,  setLimit]  = useState(200);
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState(new Set());

  const params = { type, limit,
    ...(level  && { level }),
    ...(user   && { user }),
    ...(action && { action }),
    ...(q      && { q }),
    ...(from   && { from }),
    ...(to     && { to }),
  };

  const logsQuery  = useQuery({ queryKey: ['logs', params], queryFn: () => getLogs(params),  staleTime: 0, refetchInterval: 30000 });
  const statsQuery = useQuery({ queryKey: ['logs-stats'],   queryFn: getStats,                staleTime: 30000 });

  const entries = logsQuery.data?.entries || [];
  const stats   = statsQuery.data;

  const toggleExpand = (i) => setExpanded(prev => {
    const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s;
  });

  // Export CSV
  const exportCSV = () => {
    const cols = ['timestamp','level','action','user','ip','resource','message'];
    const rows = entries.map(e => cols.map(c => JSON.stringify(e[c] ?? '')).join(','));
    const csv  = [cols.join(','), ...rows].join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `logs_${type}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="page-content space-y-5">
      <SectionHeader
        title="Journaux Système"
        subtitle="Logs structurés — erreurs, avertissements et actions utilisateurs"
        icon={Activity}
        action={
          <div className="flex gap-2">
            <button onClick={() => logsQuery.refetch()} className="btn-ghost btn-sm" disabled={logsQuery.isFetching}>
              <RefreshCw size={13} className={logsQuery.isFetching ? 'animate-spin' : ''}/>
            </button>
            <button onClick={exportCSV} className="btn-ghost btn-sm" title="Exporter CSV">
              <Download size={13}/>
            </button>
          </div>
        }
      />

      {/* ── Stats du jour ── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total aujourd\'hui', value: stats.today?.total,   accent: 'text-primary' },
            { label: 'Erreurs',            value: stats.today?.errors,  accent: 'text-danger'  },
            { label: 'Avertissements',     value: stats.today?.warns,   accent: 'text-warning' },
            { label: 'Actions utilisateurs',value: stats.today?.actions, accent: 'text-info'   },
          ].map(s => (
            <div key={s.label} className="card p-4">
              <div className="text-xs text-tertiary mb-1">{s.label}</div>
              <div className={clsx('text-2xl font-bold', s.accent)}>{s.value ?? '—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top actions + top users */}
      {stats && (stats.topActions?.length > 0 || stats.topUsers?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {stats.topActions?.length > 0 && (
            <div className="card p-4">
              <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Top actions</div>
              <div className="space-y-1.5">
                {stats.topActions.map(a => (
                  <div key={a.action} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-brand">{a.action}</span>
                    <span className="badge badge-info">{a.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stats.topUsers?.length > 0 && (
            <div className="card p-4">
              <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Top utilisateurs</div>
              <div className="space-y-1.5">
                {stats.topUsers.map(u => (
                  <div key={u.user} className="flex items-center justify-between text-xs">
                    <span className="text-primary truncate max-w-[160px]">{u.user}</span>
                    <span className="badge badge-neutral">{u.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Filtres ── */}
      <div className="card p-4 space-y-3">
        {/* Onglets type */}
        <div className="flex items-center gap-1 flex-wrap">
          {TYPE_TABS.map(t => (
            <button key={t.key} onClick={() => setType(t.key)}
              className={clsx('btn-sm flex items-center gap-1.5 text-xs',
                type === t.key ? 'btn-primary' : 'btn-ghost')}>
              <t.icon size={11}/> {t.label}
            </button>
          ))}
          <div className="flex-1"/>
          <button onClick={() => setShowFilters(v => !v)}
            className={clsx('btn-ghost btn-sm text-xs flex items-center gap-1', showFilters && 'text-primary')}>
            <Filter size={11}/> Filtres avancés
          </button>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="input text-xs w-28">
            {[50, 100, 200, 500, 1000].map(v => <option key={v} value={v}>{v} lignes</option>)}
          </select>
        </div>

        {/* Recherche rapide */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary"/>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Recherche libre (message, utilisateur, action...)"
            className="input pl-8 text-xs"/>
        </div>

        {/* Filtres avancés */}
        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="block text-xs text-tertiary mb-1">Niveau</label>
              <select value={level} onChange={e => setLevel(e.target.value)} className="input text-xs">
                <option value="">Tous</option>
                {Object.keys(LEVEL_CFG).map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-tertiary mb-1">Utilisateur</label>
              <input value={user} onChange={e => setUser(e.target.value)} placeholder="email@..." className="input text-xs"/>
            </div>
            <div>
              <label className="block text-xs text-tertiary mb-1">Action</label>
              <input value={action} onChange={e => setAction(e.target.value)} placeholder="LOGIN, IMPORT..." className="input text-xs font-mono"/>
            </div>
            <div>
              <label className="block text-xs text-tertiary mb-1">Du</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input text-xs"/>
            </div>
            <div>
              <label className="block text-xs text-tertiary mb-1">Au</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input text-xs"/>
            </div>
            <div className="flex items-end">
              <button onClick={() => { setLevel(''); setUser(''); setAction(''); setFrom(''); setTo(''); setQ(''); }}
                className="btn-ghost btn-sm text-xs w-full">
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Tableau des logs ── */}
      <div className="card overflow-hidden">
        {logsQuery.isFetching ? (
          <div className="flex justify-center py-12"><Spinner size={24}/></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-tertiary text-sm">Aucun log trouvé pour ces critères</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th style={{width:24}}></th>
                    <th>Horodatage</th>
                    <th>Niveau</th>
                    <th>Action</th>
                    <th>Utilisateur</th>
                    <th>IP</th>
                    <th>Ressource</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const cfg    = LEVEL_CFG[e.level] || LEVEL_CFG.info;
                    const isExp  = expanded.has(i);
                    const hasDet = e.details || e.stack || e.error || e.path;
                    return [
                      <tr key={i}
                        className={clsx(
                          e.level === 'error' && 'bg-danger-dim/20',
                          e.level === 'warn'  && 'bg-warning-dim/20',
                        )}>
                        <td>
                          {hasDet && (
                            <button onClick={() => toggleExpand(i)}
                              className="text-tertiary hover:text-primary text-xs px-1">
                              {isExp ? '▼' : '▶'}
                            </button>
                          )}
                        </td>
                        <td className="font-mono whitespace-nowrap">{fmtDate(e.timestamp)}</td>
                        <td>
                          <span className={clsx('badge text-xs border', cfg.cls)}>
                            {cfg.icon} {cfg.label}
                          </span>
                        </td>
                        <td className="font-mono font-semibold text-brand">{e.action || '—'}</td>
                        <td className="text-secondary truncate max-w-[120px]" title={e.user}>{e.user || '—'}</td>
                        <td className="font-mono text-tertiary">{e.ip || '—'}</td>
                        <td className="text-tertiary truncate max-w-[120px]" title={e.resource}>{e.resource || e.path || '—'}</td>
                        <td className="text-primary max-w-[240px] truncate" title={e.message}>{e.message}</td>
                      </tr>,
                      isExp && hasDet && (
                        <tr key={`${i}-d`} className="bg-surface2">
                          <td colSpan={8} className="px-4 py-3">
                            <pre className="text-xs font-mono text-secondary overflow-x-auto max-h-48 whitespace-pre-wrap">
                              {JSON.stringify(
                                Object.fromEntries(
                                  Object.entries(e).filter(([k]) =>
                                    !['timestamp','level','message','service'].includes(k))
                                ), null, 2
                              )}
                            </pre>
                          </td>
                        </tr>
                      ),
                    ].filter(Boolean);
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-border text-xs text-tertiary">
              {entries.length} entrée(s) — Rafraîchissement auto toutes les 30s
            </div>
          </>
        )}
      </div>
    </div>
  );
}
