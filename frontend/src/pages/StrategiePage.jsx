// src/pages/StrategiePage.jsx — Module Stratégie 2027-2030
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import client from '@/api/client';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  BarChart2, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle, AlertCircle, ChevronLeft,
  RefreshCw, Edit2, Check, X, Bell, BellOff
} from 'lucide-react';

// ── Constantes ───────────────────────────────────────────────
const AXE_CONFIG = {
  1: { label:'Switch national',    slug:'switch',       color:'#0891B2', bg:'bg-cyan-600' },
  2: { label:'TUNPAY',             slug:'tunpay',       color:'#7C3AED', bg:'bg-purple-600' },
  3: { label:'ClicToPay',          slug:'ctp',          color:'#059669', bg:'bg-emerald-600' },
  4: { label:'Data & Fraude',      slug:'data',         color:'#DC2626', bg:'bg-red-600' },
  5: { label:'Open Banking',       slug:'openbanking',  color:'#D97706', bg:'bg-amber-600' },
  6: { label:'Paysmart',           slug:'paysmart',     color:'#0F2444', bg:'bg-blue-800' },
  7: { label:'Programmes de place',slug:'programmes',   color:'#9333EA', bg:'bg-purple-700' },
  8: { label:'Transverse',         slug:'transverse',   color:'#374151', bg:'bg-gray-700' },
};
const SLUG_TO_AXE = Object.fromEntries(
  Object.entries(AXE_CONFIG).map(([k,v]) => [v.slug, parseInt(k)])
);

const STATUT_CFG = {
  vert  : { icon: CheckCircle,  color:'text-emerald-500', bg:'bg-emerald-50 dark:bg-emerald-900/20', label:'Objectif atteint' },
  orange: { icon: AlertCircle,  color:'text-amber-500',   bg:'bg-amber-50 dark:bg-amber-900/20',    label:'Vigilance' },
  rouge : { icon: AlertTriangle,color:'text-red-500',     bg:'bg-red-50 dark:bg-red-900/20',        label:'Hors cible' },
  na    : { icon: Minus,        color:'text-gray-400',    bg:'bg-gray-50 dark:bg-gray-800',         label:'Non mesuré' },
};

const fmt = (v, unite) => {
  if (v === null || v === undefined) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  if (unite === '%')   return `${n.toFixed(1)} %`;
  if (unite === 'TND') return `${(n/1000000).toFixed(1)} M TND`;
  if (unite === 'ms')  return `${n.toFixed(0)} ms`;
  if (unite === 'h')   return `${n.toFixed(1)} h`;
  if (unite === 'nb')  return n.toLocaleString('fr-FR');
  if (unite === 'bps') return `${n.toFixed(2)} bps`;
  return n.toFixed(2);
};

function StatutBadge({ statut, size = 'sm' }) {
  const cfg = STATUT_CFG[statut] || STATUT_CFG.na;
  const Icon = cfg.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full font-medium',
      size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1',
      cfg.bg, cfg.color)}>
      <Icon size={size === 'sm' ? 10 : 13}/>
      {cfg.label}
    </span>
  );
}

function TendanceIcon({ actuel, precedent, sens }) {
  if (actuel === null || precedent === null) return <Minus size={13} className="text-gray-400"/>;
  const diff = actuel - precedent;
  if (Math.abs(diff) < 0.01) return <Minus size={13} className="text-gray-400"/>;
  const hausse = diff > 0;
  const bon    = sens === 'haut' ? hausse : !hausse;
  if (hausse) return <TrendingUp  size={13} className={bon ? 'text-emerald-500' : 'text-red-500'}/>;
  return         <TrendingDown size={13} className={bon ? 'text-emerald-500' : 'text-red-500'}/>;
}

function ProgressBar({ valeur, cible, sens, statut }) {
  if (!valeur || !cible) return null;
  const pct = sens === 'haut'
    ? Math.min(100, (valeur / cible) * 100)
    : Math.min(100, ((2 * cible - valeur) / cible) * 100);
  const color = statut === 'vert' ? 'bg-emerald-500'
              : statut === 'orange' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
      <div className={clsx('h-1.5 rounded-full transition-all', color)}
        style={{ width: `${Math.max(2, pct)}%` }}/>
    </div>
  );
}

// ── Vue Synthèse DG ───────────────────────────────────────────
function VueSynthese() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['kpi-dashboard'],
    queryFn : () => client.get('/kpi/dashboard').then(r => r.data),
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: alertesData } = useQuery({
    queryKey: ['kpi-alertes'],
    queryFn : () => client.get('/kpi/alertes').then(r => r.data),
  });

  const mutAcquitter = useMutation({
    mutationFn: (id) => client.post(`/kpi/alertes/${id}/acquitter`),
    onSuccess : () => { toast.success('Alerte acquittée'); qc.invalidateQueries(['kpi-alertes']); },
  });

  const axes    = data?.axes    || [];
  const alertes = alertesData?.alertes || [];

  return (
    <div className="space-y-6">
      {/* Alertes actives */}
      {alertes.length > 0 && (
        <div className="card border-l-4 border-red-500 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-500">
            <Bell size={14}/> {alertes.length} alerte(s) active(s)
          </div>
          {alertes.slice(0,5).map(a => (
            <div key={a.id} className="flex items-center justify-between text-xs">
              <span className="text-secondary">
                <span className={clsx('font-semibold', a.niveau === 'rouge' ? 'text-red-500' : 'text-amber-500')}>
                  [{a.niveau.toUpperCase()}]
                </span>
                {' '}Axe {a.axe} — {a.label} : {fmt(a.valeur, a.unite)}
                {a.mois_consecutifs > 1 && ` (${a.mois_consecutifs} mois consécutifs)`}
              </span>
              <button onClick={() => mutAcquitter.mutate(a.id)}
                className="btn-ghost btn-sm text-xs flex items-center gap-1">
                <BellOff size={11}/> Acquitter
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Grille des 8 axes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {isLoading ? (
          Array(8).fill(0).map((_,i) => (
            <div key={i} className="card p-4 animate-pulse h-32 bg-surface-hover"/>
          ))
        ) : axes.map(axe => {
          const cfg = AXE_CONFIG[axe.axe] || {};
          const statCfg = STATUT_CFG[axe.statut_global] || STATUT_CFG.na;
          const Icon = statCfg.icon;
          const kpisAvecValeur = axe.kpis.filter(k => k.valeur !== null);
          return (
            <div key={axe.axe}
              onClick={() => navigate(`/strategie/${cfg.slug}`)}
              className="card p-4 cursor-pointer hover:shadow-md transition-shadow space-y-2">
              {/* Header axe */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className={clsx('w-2 h-2 rounded-full shrink-0 mt-1', cfg.bg)}/>
                  <span className="text-xs font-semibold text-primary leading-tight">
                    Axe {axe.axe} — {axe.label}
                  </span>
                </div>
                <Icon size={16} className={statCfg.color}/>
              </div>
              {/* Statut global */}
              <StatutBadge statut={axe.statut_global}/>
              {/* Mini-résumé KPI */}
              <div className="text-xs text-tertiary">
                {kpisAvecValeur.length}/{axe.kpis.length} KPI mesurés
              </div>
              {/* Points de couleur par KPI */}
              <div className="flex gap-1 flex-wrap">
                {axe.kpis.map(k => (
                  <span key={k.kpi_id} title={k.label}
                    className={clsx('w-2 h-2 rounded-full',
                      k.statut === 'vert'   ? 'bg-emerald-500' :
                      k.statut === 'orange' ? 'bg-amber-500' :
                      k.statut === 'rouge'  ? 'bg-red-500' : 'bg-gray-300')}/>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bouton collecte */}
      <div className="flex justify-end">
        <button onClick={() => qc.invalidateQueries(['kpi-dashboard'])}
          className="btn-ghost btn-sm flex items-center gap-1.5">
          <RefreshCw size={12}/> Actualiser
        </button>
      </div>
    </div>
  );
}

// ── Vue Détail Axe ────────────────────────────────────────────
function VueAxe({ axeNum }) {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const cfg      = AXE_CONFIG[axeNum] || {};
  const [saisieKpi, setSaisieKpi] = useState(null);
  const [saisieVal, setSaisieVal] = useState('');
  const [saisieNote, setSaisieNote] = useState('');
  const [saisiePer, setSaisiePer]   = useState(
    new Date().toISOString().slice(0,7) + '-01'
  );

  const { data, isLoading } = useQuery({
    queryKey: ['kpi-dashboard', axeNum],
    queryFn : () => client.get(`/kpi/dashboard?periode=`).then(r => {
      const all = r.data.axes || [];
      return all.find(a => a.axe === axeNum) || { axe: axeNum, kpis: [], statut_global:'na' };
    }),
  });

  const { data: histo } = useQuery({
    queryKey: ['kpi-values', axeNum],
    queryFn : () => client.get(`/kpi/values?axe=${axeNum}&limit=36`).then(r => r.data),
  });

  const mutSaisie = useMutation({
    mutationFn: (body) => client.post('/kpi/values', body),
    onSuccess : (res) => {
      if (res.data.mode === 'validation_requise') {
        toast('Valeur soumise — en attente de validation', { icon:'ℹ️' });
      } else {
        toast.success('Valeur enregistrée');
      }
      qc.invalidateQueries(['kpi-dashboard', axeNum]);
      qc.invalidateQueries(['kpi-values', axeNum]);
      setSaisieKpi(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erreur'),
  });

  const kpis = data?.kpis || [];
  // Historique indexé par kpi_id
  const histoByKpi = {};
  (histo?.values || []).forEach(v => {
    if (!histoByKpi[v.kpi_id]) histoByKpi[v.kpi_id] = [];
    histoByKpi[v.kpi_id].push(v);
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/strategie')}
          className="btn-ghost btn-sm flex items-center gap-1">
          <ChevronLeft size={14}/> Synthèse
        </button>
        <div className={clsx('w-3 h-3 rounded-full', cfg.bg)}/>
        <h2 className="text-base font-semibold text-primary">
          Axe {axeNum} — {cfg.label}
        </h2>
        {data && <StatutBadge statut={data.statut_global} size="md"/>}
      </div>

      {/* Cartes KPI */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array(3).fill(0).map((_,i) => (
            <div key={i} className="card p-4 animate-pulse h-40 bg-surface-hover"/>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {kpis.map(k => {
            const hist = histoByKpi[k.kpi_id] || [];
            return (
              <div key={k.kpi_id} className="card p-4 space-y-3">
                {/* Titre + statut */}
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold text-primary leading-tight flex-1">
                    {k.label}
                  </div>
                  <StatutBadge statut={k.statut || 'na'}/>
                </div>

                {/* Valeur courante */}
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-primary">
                    {fmt(k.valeur, k.unite)}
                  </span>
                  <TendanceIcon actuel={k.valeur} precedent={k.valeur_precedente}
                    sens={k.sens_amelioration}/>
                </div>

                {/* Barre progression vers cible 2027 */}
                {k.cible_2027 && (
                  <div>
                    <div className="flex justify-between text-xs text-tertiary mb-0.5">
                      <span>Cible 2027 : {fmt(k.cible_2027, k.unite)}</span>
                      <span>Cible 2030 : {fmt(k.cible_2030, k.unite)}</span>
                    </div>
                    <ProgressBar valeur={k.valeur} cible={k.cible_2027}
                      sens={k.sens_amelioration} statut={k.statut}/>
                  </div>
                )}

                {/* Seuils */}
                {(k.seuil_orange || k.seuil_rouge) && (
                  <div className="flex gap-3 text-xs text-tertiary">
                    {k.seuil_orange && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-500"/>
                        {fmt(k.seuil_orange, k.unite)}
                      </span>
                    )}
                    {k.seuil_rouge && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500"/>
                        {fmt(k.seuil_rouge, k.unite)}
                      </span>
                    )}
                  </div>
                )}

                {/* Historique mini */}
                {hist.length > 1 && (
                  <div className="flex items-end gap-0.5 h-8">
                    {hist.slice(0,12).reverse().map((v,i) => {
                      const max = Math.max(...hist.map(h => parseFloat(h.valeur||0)));
                      const pct = max > 0 ? (parseFloat(v.valeur||0)/max)*100 : 0;
                      return (
                        <div key={i} title={`${v.periode?.slice(0,7)} : ${fmt(v.valeur, k.unite)}`}
                          className={clsx('flex-1 rounded-t min-h-[2px]',
                            v.statut==='vert'  ? 'bg-emerald-400' :
                            v.statut==='orange'? 'bg-amber-400' : 'bg-red-400')}
                          style={{ height:`${Math.max(4,pct)}%` }}/>
                      );
                    })}
                  </div>
                )}

                {/* Bouton saisie manuelle */}
                {k.source === 'manuel' && (
                  <button onClick={() => { setSaisieKpi(k); setSaisieVal(''); }}
                    className="btn-ghost btn-sm text-xs flex items-center gap-1 w-full justify-center">
                    <Edit2 size={11}/> Saisir valeur
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal saisie manuelle */}
      {saisieKpi && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg p-5 w-full max-w-sm shadow-xl space-y-4">
            <div className="text-sm font-semibold text-primary">{saisieKpi.label}</div>
            <div>
              <label className="block text-xs text-secondary mb-1">Période (YYYY-MM-01)</label>
              <input type="month" value={saisiePer.slice(0,7)}
                onChange={e => setSaisiePer(e.target.value + '-01')}
                className="input-field text-sm w-full"/>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">
                Valeur ({saisieKpi.unite})
              </label>
              <input type="number" step="0.001" value={saisieVal}
                onChange={e => setSaisieVal(e.target.value)}
                className="input-field text-sm w-full"
                placeholder="ex: 97.5"/>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Note (optionnel)</label>
              <textarea value={saisieNote} onChange={e => setSaisieNote(e.target.value)}
                rows={2} className="input-field text-sm w-full"/>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => mutSaisie.mutate({
                  kpi_id: saisieKpi.kpi_id, periode: saisiePer,
                  valeur: parseFloat(saisieVal), note: saisieNote
                })}
                disabled={!saisieVal || mutSaisie.isPending}
                className="btn-primary btn-sm flex items-center gap-1">
                <Check size={12}/> Soumettre
              </button>
              <button onClick={() => setSaisieKpi(null)} className="btn-ghost btn-sm">
                <X size={12}/> Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────
export default function StrategiePage() {
  const { axeSlug } = useParams();
  const axeNum = axeSlug ? SLUG_TO_AXE[axeSlug] : null;

  return (
    <div className="space-y-4">
      {/* Header page */}
      {!axeSlug && (
        <div>
          <h1 className="text-lg font-semibold text-primary flex items-center gap-2">
            <BarChart2 size={18}/> Stratégie 2027-2030
          </h1>
          <p className="text-xs text-tertiary mt-0.5">
            Suivi des indicateurs stratégiques de la Direction des Solutions — SMT
          </p>
        </div>
      )}

      {/* Rendu conditionnel */}
      {!axeSlug
        ? <VueSynthese/>
        : axeNum
          ? <VueAxe axeNum={axeNum}/>
          : <div className="text-secondary text-sm">Axe inconnu : {axeSlug}</div>
      }
    </div>
  );
}
