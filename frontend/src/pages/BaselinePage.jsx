// src/pages/BaselinePage.jsx — Saisie des baselines 2026 et cibles KPI
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import client from '@/api/client';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  Target, Save, CheckCircle, AlertCircle, ChevronDown,
  ChevronUp, Edit2, RefreshCw, Info
} from 'lucide-react';

// ── Config axes ───────────────────────────────────────────────
const AXE_LABELS = {
  1:'Switch national', 2:'TUNPAY', 3:'ClicToPay',
  4:'Data & Fraude',   5:'Open Banking', 6:'Paysmart',
  7:'Programmes de place', 8:'Transverse',
};
const AXE_COLORS = {
  1:'border-cyan-500',   2:'border-purple-500', 3:'border-emerald-500',
  4:'border-red-500',    5:'border-amber-500',  6:'border-blue-700',
  7:'border-purple-700', 8:'border-gray-500',
};

// Champs éditables par KPI
const EDITABLE_FIELDS = [
  { key:'baseline',   label:'Baseline 2026', required:true,  hint:'Valeur de référence mesurée en 2026' },
  { key:'cible_2027', label:'Cible 2027',    required:false, hint:'Objectif fin 2027' },
  { key:'cible_2028', label:'Cible 2028',    required:false, hint:'Objectif fin 2028' },
  { key:'cible_2029', label:'Cible 2029',    required:false, hint:'Objectif fin 2029' },
  { key:'cible_2030', label:'Ambition 2030', required:false, hint:'Ambition fin 2030' },
  { key:'seuil_orange', label:'Seuil orange', required:false, hint:'Seuil d\'alerte vigilance' },
  { key:'seuil_rouge',  label:'Seuil rouge',  required:false, hint:'Seuil d\'alerte hors cible' },
];

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  return parseFloat(v).toLocaleString('fr-FR', { maximumFractionDigits:3 });
}

function KpiRow({ kpi, onSave }) {
  const [editing, setEditing] = useState(false);
  const [vals,    setVals]    = useState({});
  const [saving,  setSaving]  = useState(false);

  const hasBaseline = kpi.baseline !== null && kpi.baseline !== undefined;

  const openEdit = () => {
    setVals({
      baseline    : kpi.baseline    ?? '',
      cible_2027  : kpi.cible_2027  ?? '',
      cible_2028  : kpi.cible_2028  ?? '',
      cible_2029  : kpi.cible_2029  ?? '',
      cible_2030  : kpi.cible_2030  ?? '',
      seuil_orange: kpi.seuil_orange ?? '',
      seuil_rouge : kpi.seuil_rouge  ?? '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Convertir les chaînes vides en null, les autres en float
      const body = {};
      EDITABLE_FIELDS.forEach(f => {
        const v = vals[f.key];
        body[f.key] = (v === '' || v === null || v === undefined)
          ? null : parseFloat(String(v).replace(',','.'));
      });
      await onSave(kpi.id, body);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className={clsx('group', !hasBaseline && 'bg-amber-50/30 dark:bg-amber-900/10')}>
      {/* Code + label */}
      <td className="py-2">
        <div className="flex items-center gap-2">
          {hasBaseline
            ? <CheckCircle size={12} className="text-emerald-500 shrink-0"/>
            : <AlertCircle size={12} className="text-amber-500 shrink-0"/>}
          <div>
            <div className="text-xs font-mono font-semibold text-primary">{kpi.code}</div>
            <div className="text-xs text-secondary leading-tight">{kpi.label}</div>
          </div>
        </div>
      </td>
      {/* Unité */}
      <td className="text-center">
        <span className="text-xs bg-surface px-1.5 py-0.5 rounded font-mono text-tertiary">
          {kpi.unite}
        </span>
      </td>
      {/* Source */}
      <td className="text-center">
        <span className={clsx('text-xs px-1.5 py-0.5 rounded',
          kpi.source === 'auto'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-purple-100 text-purple-700')}>
          {kpi.source}
        </span>
      </td>

      {/* Valeurs — mode affichage ou édition */}
      {editing ? (
        <>
          {EDITABLE_FIELDS.map(f => (
            <td key={f.key} className="px-1 py-1">
              <input
                type="number" step="any"
                value={vals[f.key]}
                onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                placeholder="—"
                title={f.hint}
                className={clsx(
                  'w-full text-xs text-right px-1.5 py-1 rounded border focus:outline-none',
                  'bg-white dark:bg-gray-800 border-border focus:border-primary',
                  f.key === 'baseline' && 'border-amber-400 focus:border-amber-500'
                )}
              />
            </td>
          ))}
          <td className="text-center px-1">
            <div className="flex gap-1 justify-center">
              <button onClick={handleSave} disabled={saving}
                className="btn-primary btn-sm text-xs flex items-center gap-0.5">
                <Save size={10}/> {saving ? '…' : 'OK'}
              </button>
              <button onClick={() => setEditing(false)} className="btn-ghost btn-sm text-xs">
                ✕
              </button>
            </div>
          </td>
        </>
      ) : (
        <>
          {EDITABLE_FIELDS.map(f => (
            <td key={f.key} className="text-right text-xs font-mono text-secondary px-2">
              {f.key === 'baseline' ? (
                <span className={clsx(
                  'font-semibold',
                  hasBaseline ? 'text-primary' : 'text-amber-500 italic'
                )}>
                  {hasBaseline ? fmt(kpi.baseline) : 'À saisir'}
                </span>
              ) : (
                fmt(kpi[f.key])
              )}
            </td>
          ))}
          <td className="text-center">
            <button onClick={openEdit}
              className="btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition-opacity">
              <Edit2 size={12}/>
            </button>
          </td>
        </>
      )}
    </tr>
  );
}

function AxeSection({ axe, kpis, onSave, onSaveAll }) {
  const [expanded, setExpanded] = useState(true);
  const [editAll,  setEditAll]  = useState(false);
  const [allVals,  setAllVals]  = useState({});
  const [saving,   setSaving]   = useState(false);

  const nbBaseline = kpis.filter(k => k.baseline !== null && k.baseline !== undefined).length;
  const complet    = nbBaseline === kpis.length;

  const openEditAll = () => {
    const v = {};
    kpis.forEach(k => {
      v[k.id] = {
        baseline    : k.baseline    ?? '',
        cible_2027  : k.cible_2027  ?? '',
        cible_2028  : k.cible_2028  ?? '',
        cible_2029  : k.cible_2029  ?? '',
        cible_2030  : k.cible_2030  ?? '',
        seuil_orange: k.seuil_orange ?? '',
        seuil_rouge : k.seuil_rouge  ?? '',
      };
    });
    setAllVals(v);
    setEditAll(true);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      for (const [id, vals] of Object.entries(allVals)) {
        const body = {};
        EDITABLE_FIELDS.forEach(f => {
          const val = vals[f.key];
          body[f.key] = (val === '' || val === null || val === undefined)
            ? null : parseFloat(String(val).replace(',','.'));
        });
        await onSave(id, body);
      }
      toast.success(`Axe ${axe} — ${kpis.length} KPI sauvegardés`);
      setEditAll(false);
    } catch(e) {
      toast.error('Erreur sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={clsx('card overflow-hidden border-l-4', AXE_COLORS[axe])}>
      {/* Header axe */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border
        cursor-pointer hover:bg-surface-hover"
        onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-primary">
            Axe {axe} — {AXE_LABELS[axe]}
          </span>
          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
            complet
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700')}>
            {nbBaseline}/{kpis.length} baselines
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!editAll && (
            <button onClick={e => { e.stopPropagation(); openEditAll(); }}
              className="btn-ghost btn-sm text-xs flex items-center gap-1">
              <Edit2 size={11}/> Éditer tout l'axe
            </button>
          )}
          {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
        </div>
      </div>

      {expanded && (
        <>
          {/* Mode édition globale de l'axe */}
          {editAll ? (
            <div className="p-4 space-y-3">
              <div className="text-xs text-secondary mb-2">
                Saisissez les valeurs pour tous les KPI de cet axe puis sauvegardez.
              </div>
              {kpis.map(k => (
                <div key={k.id} className="border border-border rounded p-3 space-y-2">
                  <div className="text-xs font-semibold text-primary">{k.code}
                    <span className="ml-2 font-normal text-secondary">{k.label}</span>
                    <span className="ml-2 font-mono bg-surface px-1 rounded text-tertiary">
                      {k.unite}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {EDITABLE_FIELDS.map(f => (
                      <div key={f.key}>
                        <label className="block text-[10px] text-secondary mb-0.5">
                          {f.label}
                          {f.required && <span className="text-amber-500 ml-0.5">*</span>}
                        </label>
                        <input
                          type="number" step="any"
                          value={allVals[k.id]?.[f.key] ?? ''}
                          onChange={e => setAllVals(v => ({
                            ...v,
                            [k.id]: { ...v[k.id], [f.key]: e.target.value }
                          }))}
                          placeholder="—"
                          title={f.hint}
                          className={clsx(
                            'w-full text-xs text-right px-2 py-1 rounded border',
                            'bg-white dark:bg-gray-800 border-border focus:border-primary',
                            'focus:outline-none',
                            f.key === 'baseline' && 'border-amber-300'
                          )}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <button onClick={handleSaveAll} disabled={saving}
                  className="btn-primary flex items-center gap-1.5">
                  <Save size={13}/> {saving ? 'Sauvegarde…' : `Sauvegarder l'axe ${axe}`}
                </button>
                <button onClick={() => setEditAll(false)} className="btn-ghost">
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            /* Tableau compact */
            <div className="overflow-x-auto">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th className="text-left">KPI</th>
                    <th className="text-center">Unité</th>
                    <th className="text-center">Source</th>
                    {EDITABLE_FIELDS.map(f => (
                      <th key={f.key} className="text-right whitespace-nowrap" title={f.hint}>
                        {f.label}
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.map(k => (
                    <KpiRow key={k.id} kpi={k} onSave={onSave}/>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────
export default function BaselinePage() {
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['kpi-def-all'],
    queryFn : () => client.get('/kpi/def?actif=all').then(r => r.data),
  });

  const mutPatch = useMutation({
    mutationFn: ({ id, body }) => client.patch(`/kpi/def/${id}`, body),
    onSuccess : () => qc.invalidateQueries(['kpi-def-all']),
    onError   : (e) => toast.error(e.response?.data?.error || 'Erreur sauvegarde'),
  });

  const handleSave = async (id, body) => {
    await mutPatch.mutateAsync({ id, body });
  };

  const kpis   = data?.kpis || [];
  const byAxe  = {};
  kpis.forEach(k => {
    if (!byAxe[k.axe]) byAxe[k.axe] = [];
    byAxe[k.axe].push(k);
  });

  const totalBaselines = kpis.filter(k =>
    k.baseline !== null && k.baseline !== undefined
  ).length;
  const complet = totalBaselines === kpis.length;

  return (
    <div className="space-y-4 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-primary flex items-center gap-2">
            <Target size={18}/> Baselines & Cibles 2027-2030
          </h1>
          <p className="text-xs text-tertiary mt-0.5">
            Saisie des valeurs de référence 2026 et des objectifs stratégiques
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={clsx('text-sm font-semibold',
            complet ? 'text-emerald-500' : 'text-amber-500')}>
            {totalBaselines}/{kpis.length} baselines renseignées
          </span>
          <button onClick={() => refetch()} className="btn-ghost btn-sm flex items-center gap-1">
            <RefreshCw size={12}/> Actualiser
          </button>
        </div>
      </div>

      {/* Bandeau info */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg
        border border-blue-200 dark:border-blue-800">
        <Info size={14} className="text-blue-500 shrink-0 mt-0.5"/>
        <div className="text-xs text-blue-700 dark:text-blue-300 space-y-0.5">
          <div className="font-semibold">Comment saisir les baselines</div>
          <div>La <strong>baseline 2026</strong> est la valeur de référence mesurée sur l'année 2026.
            Elle sert de point de départ pour calculer les écarts aux cibles.</div>
          <div>Pour les KPI exprimés <strong>en variation vs 2026</strong> (ex: +1 pt), saisir la valeur absolue 2026.
            Les cibles seront calculées automatiquement.</div>
          <div>Survolez une ligne et cliquez <strong>✏️</strong> pour éditer un KPI,
            ou utilisez <strong>Éditer tout l'axe</strong> pour saisir tous les KPI en une fois.</div>
        </div>
      </div>

      {/* Sections par axe */}
      {isLoading ? (
        <div className="space-y-3">
          {Array(8).fill(0).map((_,i) => (
            <div key={i} className="card h-16 animate-pulse bg-surface-hover"/>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(byAxe)
            .sort(([a],[b]) => parseInt(a) - parseInt(b))
            .map(([axe, kpiList]) => (
              <AxeSection
                key={axe}
                axe={parseInt(axe)}
                kpis={kpiList}
                onSave={handleSave}
              />
            ))}
        </div>
      )}
    </div>
  );
}
