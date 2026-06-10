// src/components/merchants/DBMerchantsTable.jsx
import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Send, RefreshCw } from 'lucide-react';
import { EmptyState, Spinner } from '@/components/ui';
import WorkflowTimeline, { BADGE_MAP } from './WorkflowTimeline';
import ActionButtons from './ActionButtons';
import client from '@/api/client';
import toast  from 'react-hot-toast';
import clsx   from 'clsx';

const NO_ACTION_STATUTS = ['prise_en_charge','recettes_envoyees','recettes_recues',
                           'valide','banque_notifiee','en_production'];

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('fr-FR', {
    day:'2-digit', month:'2-digit', year:'2-digit'
  });
}

// ── Composant badge + bouton UAT ────────────────────────────
function UATCell({ m, onRefresh }) {
  const [loading, setLoading] = React.useState(false);

  const handleProvision = async (retry = false) => {
    setLoading(true);
    try {
      const url = `/provision-uat/${m.processing_id}${retry ? '?retry=true' : ''}`;
      await client.post(url);
      toast.success(`✅ UAT provisionné — ${m.raison_sociale}`);
      onRefresh?.();
    } catch(e) {
      const msg = e.response?.data?.error || e.message;
      toast.error(`UAT erreur : ${msg}`);
      onRefresh?.();
    } finally { setLoading(false); }
  };

  const s   = m.uat_status || 'non_provisionne';
  const mid = m.uat_merchant_id;

  if (s === 'deja_existant') {
    return (
      <div className="flex items-center gap-1">
        <span
          className="badge badge-warning text-xs cursor-default"
          title={`Marchand déjà existant sur ClicToPay UAT\n${m.uat_error_message || ''}`}>
          ⚠ Déjà existant
        </span>
        <button onClick={() => handleProvision(true)} disabled={loading}
          title="Forcer le re-provisionnement"
          className="btn-ghost btn-sm text-xs text-tertiary px-1">
          {loading ? <Spinner size={10}/> : '↺'}
        </button>
      </div>
    );
  }

  if (s === 'provisionne') {
    return (
      <div className="flex items-center gap-1">
        <span
          className="badge badge-success text-xs cursor-default"
          title={`merchantId UAT : ${mid}\nProvisionné le : ${m.uat_provisioned_at ? new Date(m.uat_provisioned_at).toLocaleDateString('fr-FR') : '—'}`}>
          ✓ UAT
        </span>
        <button onClick={() => handleProvision(true)} disabled={loading}
          title="Re-provisionner (forcer)"
          className="btn-ghost btn-sm text-xs text-tertiary px-1">
          {loading ? <Spinner size={10}/> : '↺'}
        </button>
      </div>
    );
  }

  if (s === 'api_ok') {
    return (
      <button onClick={() => handleProvision(false)} disabled={loading}
        title={`Étape 1 OK (merchantId=${mid})\nÉtape 2 SQL échouée — Cliquer pour relancer`}
        className="btn-warning btn-sm text-xs">
        {loading ? <Spinner size={11}/> : '⟳ SQL'}
      </button>
    );
  }

  if (s === 'api_erreur' || s === 'sql_erreur') {
    return (
      <button onClick={() => handleProvision(false)} disabled={loading}
        title={`Erreur ${s.replace('_',' ')} : ${m.uat_error_message || '—'}\nCliquer pour relancer`}
        className="btn-ghost btn-sm text-xs text-danger hover:bg-danger/10">
        {loading ? <Spinner size={11}/> : '✗ Retry'}
      </button>
    );
  }

  // non_provisionne — bouton +UAT
  return (
    <button onClick={() => handleProvision(false)} disabled={loading}
      title="Provisionner sur UAT ClicToPay"
      className="btn-ghost btn-sm text-xs text-brand hover:bg-brand/10">
      {loading ? <Spinner size={11}/> : '+ UAT'}
    </button>
  );
}


export default function DBMerchantsTable({ merchants, loading, onTakeOver, onDetail, onRefresh }) {
  const [sortKey, setSortKey] = useState('date_import');
  const [sortDir, setSortDir] = useState('desc');
  const [editingPayfac, setEditingPayfac] = useState(null);
  const [payfacSel,     setPayfacSel]     = useState('');
  const [syncing,       setSyncing]       = useState(false);
  const [payfacList,    setPayfacList]    = useState([]);

  // Charger la liste des PAYFACs au montage
  useEffect(() => {
    client.get('/payfacs')
      .then(r => setPayfacList(r.data?.payfacs || []))
      .catch(() => {});
  }, []);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  // ── Synchronisation Oracle ────────────────────────────
  const handleSyncOracle = async () => {
    setSyncing(true);
    try {
      const { data } = await client.post('/tracking/sync-oracle');
      toast.success(`Sync Oracle — PROD: ${data.updatedProd} · TEST: ${data.updatedTest} · Absents: ${data.updatedAbsent}`);
      onRefresh?.();
    } catch(e) {
      toast.error('Erreur sync Oracle : ' + (e.response?.data?.error || e.message));
    } finally { setSyncing(false); }
  };

  // ── Mise à jour PAYFAC ────────────────────────────────
  const handleSavePayfac = async (pid) => {
    try {
      // Trouver le nom du payfac sélectionné
      const selected = payfacList.find(p => p.id === payfacSel);
      await client.patch(`/tracking/${pid}/payfac`, {
        payfac_id : payfacSel || null,
        payfac_nom: selected?.nom || null,
      });
      toast.success(selected ? `PAYFAC "${selected.nom}" associé` : 'PAYFAC retiré');
      setEditingPayfac(null);
      onRefresh?.();
    } catch(e) {
      toast.error('Erreur mise à jour PAYFAC');
    }
  };

  const sorted = [...merchants].sort((a, b) => {
    const av = a[sortKey] || '';
    const bv = b[sortKey] || '';
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (loading) return (
    <div className="flex items-center justify-center py-16"><Spinner size={24}/></div>
  );
  if (!merchants.length) return (
    <EmptyState title="Aucun marchand en base" message="Importez un fichier Excel pour commencer le suivi."/>
  );

  const Th = ({ k, children, className = '' }) => (
    <th onClick={() => toggleSort(k)}
        className={clsx('cursor-pointer select-none hover:text-primary', className)}>
      <span className="flex items-center gap-1">
        {children}
        {sortKey === k ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>) : null}
      </span>
    </th>
  );

  return (
    <div className="card overflow-hidden">
      {/* Bouton Sync Oracle */}
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs text-tertiary">{merchants.length.toLocaleString('fr-FR')} marchand(s)</span>
        <button onClick={handleSyncOracle} disabled={syncing}
          className="btn-ghost btn-sm text-xs flex items-center gap-1.5">
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''}/>
          {syncing ? 'Synchronisation…' : 'Sync Oracle'}
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th k="processing_id">Affiliation</Th>
              <Th k="raison_sociale">Raison sociale</Th>
              <Th k="terminal_id">Terminal</Th>
              <th>Email</th>
              <Th k="mcc">MCC</Th>
              <th>URL</th>
              <th>Oracle</th>
              <th>UAT</th>
              <Th k="payfac_nom">PAYFAC</Th>
              <th className="min-w-[200px]">Progression</th>
              <Th k="date_import">Date création</Th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => {
              const hideAction = NO_ACTION_STATUTS.includes(m.statut);
              const dateAffichee = m.date_creation_excel || m.date_import;
              const isEditingPF  = editingPayfac === m.processing_id;

              return (
                <tr key={m.processing_id || i}>
                  <td className="font-mono text-xs text-brand cursor-pointer hover:underline"
                      onClick={() => onDetail?.(m)}>
                    {m.processing_id}
                  </td>
                  <td className="font-medium max-w-[140px] truncate" title={m.raison_sociale}>
                    {m.raison_sociale || '—'}
                  </td>
                  <td className="font-mono text-xs text-secondary">
                    {m.terminal_id || '—'}
                  </td>
                  <td className="text-xs text-tertiary max-w-[130px] truncate"
                      title={m.email_contact || m.webmaster}>
                    {m.email_contact || m.webmaster || '—'}
                  </td>
                  <td className="font-mono text-xs text-secondary text-center">
                    {m.mcc || '—'}
                  </td>
                  <td className="text-xs max-w-[120px] truncate">
                    {m.site_web || m.site_url || m.url ? (
                      <a href={m.site_web || m.site_url || m.url}
                         target="_blank" rel="noreferrer"
                         title={m.site_web || m.site_url || m.url}
                         className="text-brand hover:underline">
                        {(m.site_web || m.site_url || m.url).replace(/^https?:\/\/(www\.)?/, '')}
                      </a>
                    ) : <span className="text-tertiary">—</span>}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      {m.oracle_prod && <span className="badge badge-success text-xs">PROD</span>}
                      {m.oracle_test && <span className="badge badge-info    text-xs">TEST</span>}
                      {!m.oracle_prod && !m.oracle_test && <span className="badge badge-danger text-xs">Absent</span>}
                    </div>
                  </td>

                  {/* ── UAT Provisioning ── */}
                  <td>
                    <UATCell m={m} onRefresh={onRefresh}/>
                  </td>

                  {/* ── PAYFAC ── */}
                  <td className="max-w-[130px]">
                    {isEditingPF ? (
                      <div className="flex items-center gap-1">
                        <select
                          autoFocus
                          value={payfacSel}
                          onChange={e => setPayfacSel(e.target.value)}
                          className="input text-xs py-0.5 px-1.5 w-28"
                        >
                          <option value="">— Aucun —</option>
                          {payfacList.filter(p => p.actif !== false).map(p => (
                            <option key={p.id} value={p.id}>{p.nom}</option>
                          ))}
                        </select>
                        <button onClick={() => handleSavePayfac(m.processing_id)}
                          className="text-success hover:text-success/80 text-xs font-bold px-1">✓</button>
                        <button onClick={() => setEditingPayfac(null)}
                          className="text-danger hover:text-danger/80 text-xs font-bold px-1">✕</button>
                      </div>
                    ) : (
                      <div
                        className="cursor-pointer hover:bg-surface3 rounded px-1 py-0.5 group flex items-center gap-1"
                        onClick={() => {
                          setEditingPayfac(m.processing_id);
                          // Pré-sélectionner le payfac actuel
                          const current = payfacList.find(p => p.nom === m.payfac_nom || p.id === m.payfac_id);
                          setPayfacSel(current?.id || '');
                        }}
                        title="Cliquer pour modifier">
                        {m.payfac_nom
                          ? <span className="badge badge-info text-xs truncate max-w-[110px]">{m.payfac_nom}</span>
                          : <span className="text-xs text-tertiary/50 group-hover:text-tertiary">—</span>}
                      </div>
                    )}
                  </td>

                  <td className="min-w-[200px]">
                    <WorkflowTimeline merchant={m} compact/>
                  </td>
                  <td className="text-xs text-tertiary whitespace-nowrap">
                    {fmtDate(dateAffichee)}
                    {m.jours_depuis_import != null && (
                      <span className="ml-1 text-tertiary/50">({m.jours_depuis_import}j)</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      {!hideAction ? (
                        <button onClick={() => onTakeOver?.(m)} className="btn-ghost btn-sm text-xs">
                          <Send size={11}/> Prise en charge
                        </button>
                      ) : (
                        <button onClick={() => onDetail?.(m)} className="btn-ghost btn-sm text-xs">
                          Détail
                        </button>
                      )}
                      <ActionButtons merchant={m} onDone={onRefresh}/>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-border text-xs text-tertiary">
        {merchants.length.toLocaleString('fr-FR')} marchand(s)
      </div>
    </div>
  );
}
