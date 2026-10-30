// src/pages/ReconciliationPage.jsx
import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import client from '@/api/client';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertCircle,
  Download, RefreshCw, Loader2, ChevronLeft
} from 'lucide-react';

const fmt  = n => (n||0).toLocaleString('fr-FR');
const fmtM = n => `${fmt(Math.round(n||0))} TND`;

function KpiCard({ label, value, sub, color='text-primary' }) {
  return (
    <div className="card p-4">
      <div className={clsx('text-2xl font-semibold', color)}>{value}</div>
      <div className="text-xs text-secondary mt-1">{label}</div>
      {sub && <div className="text-xs text-tertiary mt-0.5">{sub}</div>}
    </div>
  );
}

function BadgeStatut({ statut }) {
  const cfg = {
    reconcilie_ctp     : { label:'✓ CTP',      cls:'badge-success' },
    reconcilie_paysmart: { label:'✓ Paysmart', cls:'badge-info' },
    non_reconcilie     : { label:'✗ Non réconcilié', cls:'badge-danger' },
  }[statut] || { label: statut, cls: 'badge-neutral' };
  return <span className={clsx('badge text-xs', cfg.cls)}>{cfg.label}</span>;
}

export default function ReconciliationPage() {
  const qc = useQueryClient();
  const [uploading,    setUploading]    = useState(false);
  const [selectedId,   setSelectedId]   = useState(null);
  const [filterStatut, setFilterStatut] = useState('');
  const [page,         setPage]         = useState(1);

  // Liste des fichiers
  const { data: fichiersData, isLoading: fichiersLoading } = useQuery({
    queryKey: ['recon-fichiers'],
    queryFn : () => client.get('/reconciliation/fichiers').then(r => r.data),
  });

  // Stats du fichier sélectionné
  const { data: statsData } = useQuery({
    queryKey: ['recon-stats', selectedId],
    queryFn : () => client.get(`/reconciliation/${selectedId}/stats`).then(r => r.data),
    enabled : !!selectedId,
  });

  // Écarts du fichier sélectionné
  const { data: ecartsData, isLoading: ecartsLoading } = useQuery({
    queryKey: ['recon-ecarts', selectedId, filterStatut, page],
    queryFn : () => client.get(`/reconciliation/${selectedId}/ecarts`, {
      params: { statut: filterStatut || undefined, page, limit: 100 }
    }).then(r => r.data),
    enabled: !!selectedId,
  });

  // Upload
  const onDrop = useCallback(async (acceptedFiles) => {
    if (!acceptedFiles.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      acceptedFiles.forEach(f => fd.append('fichiers', f));
      const { data } = await client.post('/reconciliation/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      toast.success(`${data.results.length} fichier(s) traité(s)`);
      qc.invalidateQueries(['recon-fichiers']);
      if (data.results[0] && !data.results[0].erreur) {
        // Auto-sélectionner le premier fichier uploadé
        qc.invalidateQueries(['recon-fichiers']);
      }
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur upload');
    } finally {
      setUploading(false);
    }
  }, [qc]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'text/csv': ['.csv'] }, multiple: true,
  });

  const handleExport = async () => {
    try {
      const res = await client.get(`/reconciliation/${selectedId}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement('a'); a.href = url;
      a.download = `Reconciliation_${selectedId.slice(0,8)}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch(e) { toast.error('Erreur export'); }
  };

  const stats   = statsData?.stats;
  const ecarts  = ecartsData?.lignes || [];
  const fichiers = fichiersData?.fichiers || [];
  const selected = fichiers.find(f => f.id === selectedId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {selectedId && (
            <button onClick={() => { setSelectedId(null); setFilterStatut(''); setPage(1); }}
              className="btn-ghost btn-sm flex items-center gap-1 mb-2">
              <ChevronLeft size={14}/> Retour
            </button>
          )}
          <h1 className="text-lg font-semibold text-primary">
            {selectedId ? `Réconciliation — ${selected?.nom_fichier}` : 'Réconciliation Ministère'}
          </h1>
          <p className="text-xs text-tertiary mt-0.5">
            {selectedId
              ? `Date : ${new Date(selected?.date_fichier).toLocaleDateString('fr-FR')}`
              : 'Upload et réconciliation des fichiers de paiements du Ministère'}
          </p>
        </div>
        {selectedId && (
          <button onClick={handleExport} className="btn-success btn-sm flex items-center gap-1.5">
            <Download size={13}/> Export Excel
          </button>
        )}
      </div>

      {!selectedId ? (
        <>
          {/* Zone upload */}
          <div {...getRootProps()} className={clsx(
            'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
            isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          )}>
            <input {...getInputProps()}/>
            {uploading ? (
              <div className="flex flex-col items-center gap-2 text-secondary">
                <Loader2 size={28} className="animate-spin text-primary"/>
                <span className="text-sm">Traitement en cours…</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-tertiary">
                <Upload size={28} className={isDragActive ? 'text-primary' : ''}/>
                <span className="text-sm font-medium text-secondary">
                  {isDragActive ? 'Déposez les fichiers ici' : 'Glissez vos fichiers CSV ou cliquez pour sélectionner'}
                </span>
                <span className="text-xs">Un ou plusieurs fichiers CSV (séparateur ;) — max 10 Mo chacun</span>
              </div>
            )}
          </div>

          {/* Liste des fichiers */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide flex items-center justify-between">
              <span>Fichiers traités</span>
              <div className="flex items-center gap-2">
                <button onClick={() => qc.invalidateQueries(['recon-fichiers'])} className="btn-ghost btn-sm">
                  <RefreshCw size={12}/>
                </button>
                <button onClick={async () => {
                  if (!confirm('Supprimer toutes les réconciliations ? Cette action est irréversible.')) return;
                  try {
                    await client.delete('/reconciliation/reset');
                    toast.success('Réconciliations réinitialisées');
                    qc.invalidateQueries(['recon-fichiers']);
                    setSelectedId(null);
                  } catch(e) { toast.error('Erreur réinitialisation'); }
                }} className="btn-danger btn-sm flex items-center gap-1">
                  <XCircle size={12}/> Réinitialiser
                </button>
              </div>
            </div>
            {fichiersLoading ? (
              <div className="flex items-center justify-center h-24 gap-2 text-secondary text-sm">
                <Loader2 size={14} className="animate-spin"/> Chargement…
              </div>
            ) : !fichiers.length ? (
              <div className="flex flex-col items-center justify-center h-24 gap-2 text-tertiary text-sm">
                <FileText size={20} className="opacity-40"/>
                Aucun fichier traité
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fichier</th>
                    <th className="text-center">Date</th>
                    <th className="text-center">Lignes</th>
                    <th className="text-center">Réconciliés</th>
                    <th className="text-center">Non réconciliés</th>
                    <th className="text-center">Taux</th>
                    <th className="text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {fichiers.map(f => {
                    const total  = parseInt(f.total||0);
                    const recon  = parseInt(f.reconcilies||0);
                    const nonR   = parseInt(f.non_reconcilies||0);
                    const taux   = total > 0 ? Math.round(recon/total*100) : 0;
                    return (
                      <tr key={f.id}>
                        <td className="font-mono text-xs">{f.nom_fichier}</td>
                        <td className="text-center text-xs">
                          {new Date(f.date_fichier).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="text-center font-medium">{fmt(total)}</td>
                        <td className="text-center">
                          <span className="badge badge-success text-xs">{fmt(recon)}</span>
                        </td>
                        <td className="text-center">
                          <span className="badge badge-danger text-xs">{fmt(nonR)}</span>
                        </td>
                        <td className="text-center">
                          <span className={clsx('font-semibold text-sm',
                            taux >= 95 ? 'text-success' : taux >= 80 ? 'text-warning' : 'text-danger')}>
                            {taux}%
                          </span>
                        </td>
                        <td className="text-center">
                          <div className="flex items-center gap-1 justify-center">
                          <button onClick={() => setSelectedId(f.id)}
                            className="btn-primary btn-sm">Voir</button>
                          <button onClick={async () => {
                            if (!confirm('Supprimer ce fichier ?')) return;
                            try {
                              await client.delete('/reconciliation/' + f.id);
                              toast.success('Fichier supprimé');
                              qc.invalidateQueries(['recon-fichiers']);
                            } catch(e) { toast.error('Erreur suppression'); }
                          }} className="btn-danger btn-sm">
                            <XCircle size={12}/>
                          </button>
                        </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          {/* KPIs */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total lignes"       value={fmt(stats.total)}           color="text-primary"/>
              <KpiCard label="Réconciliés"        value={fmt(stats.reconcilies)}     color="text-success"
                sub={`CTP: ${fmt(stats.via_ctp)} · PSM: ${fmt(stats.via_paysmart)}`}/>
              <KpiCard label="Non réconciliés"    value={fmt(stats.non_reconcilies)} color="text-danger"/>
              <KpiCard label="Taux"               value={`${stats.taux}%`}
                color={stats.taux >= 95 ? 'text-success' : stats.taux >= 80 ? 'text-warning' : 'text-danger'}
                sub={`${fmtM(stats.montant_reconcilie)} / ${fmtM(stats.montant_total)}`}/>
            </div>
          )}

          {/* Filtres */}
          <div className="flex items-center gap-2">
            {['', 'reconcilie_ctp', 'reconcilie_paysmart', 'non_reconcilie'].map(s => (
              <button key={s} onClick={() => { setFilterStatut(s); setPage(1); }}
                className={clsx('btn-sm', filterStatut === s ? 'btn-primary' : 'btn-ghost')}>
                {s === '' ? 'Tous' : s === 'reconcilie_ctp' ? '✓ CTP'
                  : s === 'reconcilie_paysmart' ? '✓ Paysmart' : '✗ Non réconciliés'}
              </button>
            ))}
            <span className="text-xs text-tertiary ml-auto">
              {fmt(ecartsData?.total || 0)} ligne(s)
            </span>
          </div>

          {/* Tableau des écarts */}
          <div className="card overflow-hidden">
            {ecartsLoading ? (
              <div className="flex items-center justify-center h-24 gap-2 text-secondary text-sm">
                <Loader2 size={14} className="animate-spin"/> Chargement…
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Autorisation</th>
                    <th>Date paiement</th>
                    <th>ID Élève</th>
                    <th className="text-center">Montant</th>
                    <th>Session CNTE</th>
                    <th>Type</th>
                    <th className="text-center">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {ecarts.map(e => (
                    <tr key={e.id}>
                      <td className="font-mono text-xs">{e.autorisation}</td>
                      <td className="text-xs">
                        {e.date_paiement ? new Date(e.date_paiement).toLocaleString('fr-FR') : '—'}
                      </td>
                      <td className="font-mono text-xs">{e.id_eleve}</td>
                      <td className="text-center text-xs">{fmt(e.montant)} TND</td>
                      <td className="font-mono text-xs text-tertiary truncate max-w-32">{e.session_cnte}</td>
                      <td className="text-xs">{e.type_paiement}</td>
                      <td className="text-center"><BadgeStatut statut={e.statut_recon}/></td>
                    </tr>
                  ))}
                  {!ecarts.length && (
                    <tr><td colSpan={7} className="text-center text-tertiary py-8 text-sm">Aucune ligne</td></tr>
                  )}
                </tbody>
              </table>
            )}
            {/* Pagination */}
            {ecartsData?.total > 100 && (
              <div className="flex items-center justify-center gap-2 p-3 border-t border-border">
                <button disabled={page===1} onClick={() => setPage(p=>p-1)} className="btn-ghost btn-sm">←</button>
                <span className="text-xs text-secondary">Page {page} / {Math.ceil(ecartsData.total/100)}</span>
                <button disabled={page>=Math.ceil(ecartsData.total/100)} onClick={() => setPage(p=>p+1)} className="btn-ghost btn-sm">→</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
