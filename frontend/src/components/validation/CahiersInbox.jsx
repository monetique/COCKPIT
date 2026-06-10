// src/components/validation/CahiersInbox.jsx
// Boîte de réception des cahiers de recettes
// — upload → extraction processing_id → marquage auto recettes_recues
import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient }      from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Upload, Download, Trash2, Play,
  RefreshCw, FileSpreadsheet, FolderOpen,
  CheckCircle2, Clock, AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx  from 'clsx';
import { Spinner, EmptyState } from '@/components/ui';
import { listCahiers, uploadCahier, downloadCahier, readCahier, deleteCahier } from '@/api/cahiers';
import client from '@/api/client';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('fr-FR', {
    day:'2-digit', month:'2-digit', year:'2-digit',
    hour:'2-digit', minute:'2-digit'
  });
}
function fmtSize(kb) {
  return kb >= 1024 ? `${(kb/1024).toFixed(1)} MB` : `${kb} KB`;
}

// Badge statut workflow
function StatutBadge({ statut }) {
  if (!statut) return <span className="text-xs text-tertiary">—</span>;
  const cfg = {
    en_attente         : { label:'En attente',         cls:'badge-neutral'  },
    prise_en_charge    : { label:'Prise en charge',    cls:'badge-info'     },
    recettes_envoyees  : { label:'Recettes envoyées',  cls:'badge-warning'  },
    recettes_recues    : { label:'Recettes reçues',    cls:'badge-success'  },
    valide             : { label:'Validé',             cls:'badge-success'  },
    banque_notifiee    : { label:'Banque notifiée',    cls:'badge-info'     },
    en_production      : { label:'En production',      cls:'badge-success'  },
  };
  const c = cfg[statut] || { label: statut, cls: 'badge-neutral' };
  return <span className={`badge text-xs ${c.cls}`}>{c.label}</span>;
}

export default function CahiersInbox({ onAnalyze }) {
  const qc      = useQueryClient();
  const fileRef = useRef();
  const [dragging,   setDragging]   = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [analyzing,  setAnalyzing]  = useState(null);
  const [deleting,   setDeleting]   = useState(null);
  const [marking,    setMarking]    = useState(null);

  // ── Charger la liste ──────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['cahiers-inbox'],
    queryFn : () => listCahiers().then(r => r.data),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const files = data?.files || [];

  // ── Upload ────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast.error('Seuls les fichiers .xlsx et .xls sont acceptés');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data: result } = await uploadCahier(fd);

      if (result.auto_marked && result.merchant) {
        // Marquage automatique recettes_recues réussi
        toast.success(
          `✅ ${file.name} déposé\n` +
          `📬 ${result.merchant.raison_sociale} → Recettes reçues`,
          { duration: 5000 }
        );
        // Invalider aussi la liste des marchands
        qc.invalidateQueries({ queryKey: ['merchants'] });
        qc.invalidateQueries({ queryKey: ['tracking'] });
      } else if (result.processing_id && result.merchant) {
        // Marchand trouvé mais pas en recettes_envoyees (statut incompatible)
        toast(
          `📥 ${file.name} déposé\n` +
          `ℹ️ ${result.merchant.raison_sociale} — statut : ${result.merchant.statut}`,
          { icon: '📋', duration: 4000 }
        );
      } else if (result.processing_id && !result.merchant) {
        // Processing ID extrait mais marchand inconnu localement
        toast(
          `📥 ${file.name} déposé\n` +
          `⚠️ Processing ID ${result.processing_id} non trouvé en base locale`,
          { icon: '⚠️', duration: 4000 }
        );
      } else {
        // Pas de processing_id reconnu
        toast.success(`📥 ${file.name} déposé dans la boîte de réception`);
      }
      qc.invalidateQueries({ queryKey: ['cahiers-inbox'] });
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur dépôt : ' + e.message);
    } finally {
      setUploading(false);
    }
  }, [qc]);

  const onDrop  = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); };
  const onInput = (e) => { handleFile(e.target.files[0]); e.target.value = ''; };

  // ── Marquage manuel recettes_reçues ───────────────────
  const handleMarkReceived = async (file) => {
    const pid = file.processing_id;
    if (!pid) { toast.error('Processing ID inconnu pour ce fichier'); return; }
    setMarking(file.filename);
    try {
      await client.post('/cahiers/mark-received', { processing_id: pid });
      toast.success(`📬 ${file.merchant?.raison_sociale || pid} → Recettes reçues`);
      qc.invalidateQueries({ queryKey: ['cahiers-inbox'] });
      qc.invalidateQueries({ queryKey: ['merchants'] });
      qc.invalidateQueries({ queryKey: ['tracking'] });
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur marquage');
    } finally {
      setMarking(null);
    }
  };

  // ── Analyser depuis l'inbox ───────────────────────────
  const handleAnalyze = async (file) => {
    setAnalyzing(file.filename);
    try {
      const { data } = await readCahier(file.filename);
      const binary = atob(data.base64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const wb = XLSX.read(bytes.buffer, { type: 'array' });
      onAnalyze?.(wb, file.originalName || file.filename);
      toast.success(`Analyse lancée : ${file.originalName}`);
    } catch(e) {
      toast.error('Erreur lecture fichier : ' + e.message);
    } finally {
      setAnalyzing(null);
    }
  };

  // ── Télécharger ───────────────────────────────────────
  const handleDownload = async (file) => {
    try {
      const { data: blob } = await downloadCahier(file.filename);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = file.originalName || file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      toast.error('Erreur téléchargement : ' + e.message);
    }
  };

  // ── Supprimer ─────────────────────────────────────────
  const handleDelete = async (file) => {
    if (!confirm(`Supprimer "${file.originalName}" ?`)) return;
    setDeleting(file.filename);
    try {
      await deleteCahier(file.filename);
      toast.success('Fichier supprimé');
      qc.invalidateQueries({ queryKey: ['cahiers-inbox'] });
    } catch(e) {
      toast.error('Erreur suppression : ' + e.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header inbox */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen size={15} className="text-brand"/>
          <span className="text-sm font-semibold text-primary">
            Boîte de réception
          </span>
          <span className="badge badge-neutral text-xs ml-1">
            {files.length} fichier(s)
          </span>
        </div>
        <button onClick={() => refetch()} className="btn-ghost btn-sm" title="Actualiser">
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''}/>
        </button>
      </div>

      {/* Zone de dépôt */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={clsx(
          'border-2 border-dashed rounded-lg px-4 py-5 flex items-center gap-3 cursor-pointer transition-all',
          dragging ? 'border-brand bg-brand/5' : 'border-border hover:border-border2 hover:bg-surface2'
        )}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onInput}/>
        {uploading ? <Spinner size={18}/> : (
          <Upload size={18} className={dragging ? 'text-brand' : 'text-tertiary'}/>
        )}
        <div>
          <div className="text-sm text-primary font-medium">
            {uploading ? 'Dépôt en cours…' : dragging ? 'Déposer le fichier' : 'Déposer un cahier de recettes'}
          </div>
          <div className="text-xs text-tertiary mt-0.5">
            Glissez-déposez ou cliquez · .xlsx / .xls · 10 MB max
          </div>
          <div className="text-xs text-tertiary/60 mt-1">
            Le Processing ID est extrait automatiquement — le statut marchand est mis à jour si applicable
          </div>
        </div>
      </div>

      {/* Liste des fichiers */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Spinner size={20}/></div>
      ) : files.length === 0 ? (
        <EmptyState
          title="Aucun cahier déposé"
          message="Déposez les fichiers Excel remplis par les marchands."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fichier</th>
                <th>Marchand</th>
                <th>Statut</th>
                <th>Taille</th>
                <th>Déposé le</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map(file => (
                <tr key={file.filename}>
                  <td>
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet size={14} className="text-success shrink-0"/>
                      <div>
                        <div className="text-sm text-primary truncate max-w-[200px]" title={file.originalName}>
                          {file.originalName}
                        </div>
                        {file.processing_id && (
                          <div className="text-xs text-tertiary font-mono">{file.processing_id}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {file.merchant ? (
                      <div className="text-xs text-primary font-medium truncate max-w-[160px]"
                           title={file.merchant.raison_sociale}>
                        {file.merchant.raison_sociale}
                      </div>
                    ) : file.processing_id ? (
                      <span className="text-xs text-warning">Non trouvé en base</span>
                    ) : (
                      <span className="text-xs text-tertiary">—</span>
                    )}
                  </td>
                  <td>
                    <StatutBadge statut={file.merchant?.statut}/>
                  </td>
                  <td className="text-xs text-tertiary font-mono">
                    {fmtSize(file.sizeKB)}
                  </td>
                  <td className="text-xs text-tertiary whitespace-nowrap">
                    {fmtDate(file.uploadedAt)}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">

                      {/* Marquer reçu — visible si recettes_envoyees ou prise_en_charge */}
                      {file.merchant && ['recettes_envoyees','prise_en_charge'].includes(file.merchant.statut) && (
                        <button
                          onClick={() => handleMarkReceived(file)}
                          disabled={marking === file.filename}
                          title="Marquer les recettes comme reçues"
                          className="btn-success btn-sm text-xs"
                        >
                          {marking === file.filename
                            ? <Spinner size={11}/>
                            : <CheckCircle2 size={11}/>}
                          Reçu
                        </button>
                      )}

                      {/* Analyser */}
                      <button
                        onClick={() => handleAnalyze(file)}
                        disabled={!!analyzing}
                        title="Analyser ce cahier"
                        className="btn-primary btn-sm text-xs"
                      >
                        {analyzing === file.filename
                          ? <Spinner size={11}/>
                          : <Play size={11}/>}
                        Analyser
                      </button>

                      {/* Télécharger */}
                      <button
                        onClick={() => handleDownload(file)}
                        title="Télécharger"
                        className="btn-ghost btn-sm"
                      >
                        <Download size={12}/>
                      </button>

                      {/* Supprimer */}
                      <button
                        onClick={() => handleDelete(file)}
                        disabled={deleting === file.filename}
                        title="Supprimer"
                        className="btn-ghost btn-sm text-danger/60 hover:text-danger"
                      >
                        {deleting === file.filename
                          ? <Spinner size={12}/>
                          : <Trash2 size={12}/>}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.dir && (
        <div className="text-xs text-tertiary/60 font-mono px-1">
          {data.dir}
        </div>
      )}
    </div>
  );
}
