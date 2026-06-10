// src/pages/BanquesDashboardPage.jsx
import { useQuery } from '@tanstack/react-query';
import client from '@/api/client';
import clsx from 'clsx';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, PieChart, Pie, Cell
} from 'recharts';
import useAuthStore from '@/store/authStore';
import { Loader2, AlertCircle, TrendingUp, Users, CheckCircle2, Zap } from 'lucide-react';

// ── Couleurs cohérentes avec le thème ──────────────────
const STATUT_CFG = {
  en_attente       : { label: 'En attente',        color: '#64748b' },
  prise_en_charge  : { label: 'Prise en charge',   color: '#3b82f6' },
  recettes_envoyees: { label: 'Recettes envoyées', color: '#f59e0b' },
  recettes_recues  : { label: 'Recettes reçues',   color: '#f97316' },
  valide           : { label: 'Validé',            color: '#10b981' },
  banque_notifiee  : { label: 'Banque notifiée',   color: '#8b5cf6' },
  en_production    : { label: 'En production',     color: '#22c55e' },
};

const UAT_CFG = {
  non_provisionne: { label: 'Non provisionné', color: '#64748b' },
  api_ok         : { label: 'SQL en attente',  color: '#f59e0b' },
  provisionne    : { label: 'Provisionné',     color: '#10b981' },
  api_erreur     : { label: 'Erreur API',      color: '#ef4444' },
  sql_erreur     : { label: 'Erreur SQL',      color: '#ef4444' },
  deja_existant  : { label: 'Déjà existant',   color: '#f97316' },
};

const BAR_COLORS = {
  creations  : '#3b82f6',
  productions: '#22c55e',
};

function KpiCard({ label, value, sub, icon: Icon, color = '#3b82f6' }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
           style={{ background: color + '22' }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-semibold text-primary">{value ?? '—'}</div>
        <div className="text-xs font-medium text-secondary mt-0.5">{label}</div>
        {sub && <div className="text-xs text-tertiary mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-primary mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: p.fill }}/>
          <span className="text-secondary">{p.name === 'creations' ? 'Créations' : 'Mises en prod'} : </span>
          <span className="font-medium text-primary">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function BanquesDashboardPage() {
  const { user } = useAuthStore();
  const isBanquier = user?.role === 'banquier';

  const { data, isLoading, error } = useQuery({
    queryKey : ['banques-dashboard-stats'],
    queryFn  : () => client.get('/banques-dashboard/stats').then(r => r.data),
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey : ['banques-dashboard-list'],
    queryFn  : () => client.get('/banques-dashboard/list').then(r => r.data),
    enabled  : !isBanquier,
    retry: 2,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 gap-2 text-secondary text-sm">
      <Loader2 size={18} className="animate-spin"/> Chargement des données…
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center h-64 gap-2 text-danger text-sm">
      <AlertCircle size={18}/>
      Erreur : {error.response?.data?.error || error.message}
    </div>
  );

  const t  = data?.totaux   || {};
  const ev = data?.evolution || [];
  const bs = data?.byStatut  || [];
  const bu = data?.uat       || [];

  // Préparer données PieChart statuts
  const pieStatuts = bs
    .filter(r => Number(r.total) > 0)
    .map(r => ({
      name : STATUT_CFG[r.statut]?.label || r.statut,
      value: Number(r.total),
      color: STATUT_CFG[r.statut]?.color || '#64748b',
    }));

  // Préparer données PieChart UAT
  const pieUat = bu
    .filter(r => Number(r.total) > 0)
    .map(r => ({
      name : UAT_CFG[r.uat_status]?.label || r.uat_status,
      value: Number(r.total),
      color: UAT_CFG[r.uat_status]?.color || '#64748b',
    }));

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-primary">
          {isBanquier ? `Tableau de bord — Banque ${user?.bank_code}` : 'Vue par banque'}
        </h1>
        <p className="text-xs text-tertiary mt-0.5">
          {isBanquier
            ? 'Indicateurs de vos marchands uniquement'
            : 'Répartition et évolution des marchands par banque'}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total marchands"  value={t.total}          icon={Users}        color="#3b82f6"/>
        <KpiCard label="En production"    value={t.en_production}  icon={CheckCircle2} color="#22c55e"
                 sub={t.oracle_prod > 0 ? `${t.oracle_prod} sync Oracle` : undefined}/>
        <KpiCard label="En cours"         value={Number(t.recettes_envoyees || 0) + Number(t.valides || 0)}
                 icon={TrendingUp} color="#f59e0b"/>
        <KpiCard label="UAT provisionné"  value={t.uat_ok}         icon={Zap}          color="#8b5cf6"/>
      </div>

      {/* Répartition statuts + UAT */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Pie statuts */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide">
            Répartition par statut
          </div>
          {pieStatuts.length === 0 ? (
            <div className="p-8 text-center text-xs text-tertiary">Aucune donnée</div>
          ) : (
            <div className="p-4 flex gap-4 items-center">
              <div style={{ width: 140, height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieStatuts} dataKey="value" cx="50%" cy="50%"
                         innerRadius={35} outerRadius={60} paddingAngle={2}>
                      {pieStatuts.map((e, i) => <Cell key={i} fill={e.color}/>)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]}
                             contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid var(--color-border-tertiary)', background: 'var(--color-background-primary)' }}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                {pieStatuts.map((e, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color }}/>
                      <span className="text-secondary truncate">{e.name}</span>
                    </div>
                    <span className="font-semibold text-primary shrink-0">{e.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Pie UAT */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide">
            Statut UAT ClicToPay
          </div>
          {pieUat.length === 0 ? (
            <div className="p-8 text-center text-xs text-tertiary">Aucune donnée</div>
          ) : (
            <div className="p-4 flex gap-4 items-center">
              <div style={{ width: 140, height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieUat} dataKey="value" cx="50%" cy="50%"
                         innerRadius={35} outerRadius={60} paddingAngle={2}>
                      {pieUat.map((e, i) => <Cell key={i} fill={e.color}/>)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]}
                             contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid var(--color-border-tertiary)', background: 'var(--color-background-primary)' }}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                {pieUat.map((e, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color }}/>
                      <span className="text-secondary truncate">{e.name}</span>
                    </div>
                    <span className="font-semibold text-primary shrink-0">{e.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Histogramme évolution */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide">
          Évolution mensuelle — 12 derniers mois
        </div>
        {ev.length === 0 ? (
          <div className="p-8 text-center text-xs text-tertiary">Aucune donnée d'évolution</div>
        ) : (
          <div className="p-4" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ev} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                        barCategoryGap="30%">
                <XAxis dataKey="mois" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
                       axisLine={false} tickLine={false}/>
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
                       axisLine={false} tickLine={false}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Legend formatter={n => (
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {n === 'creations' ? 'Créations' : 'Mises en prod'}
                  </span>
                )}/>
                <Bar dataKey="creations"   fill={BAR_COLORS.creations}   radius={[3,3,0,0]} maxBarSize={24}/>
                <Bar dataKey="productions" fill={BAR_COLORS.productions} radius={[3,3,0,0]} maxBarSize={24}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Tableau par banque (admin/supervisor uniquement) */}
      {!isBanquier && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide">
            Détail par banque
          </div>
          {listLoading ? (
            <div className="p-8 text-center text-xs text-tertiary flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin"/> Chargement…
            </div>
          ) : !listData?.data?.length ? (
            <div className="p-8 text-center text-xs text-tertiary">Aucune banque configurée</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Banque</th>
                  <th className="text-center">Total</th>
                  <th className="text-center">En prod</th>
                  <th className="text-center">En cours</th>
                  <th className="text-center">En attente</th>
                  <th className="text-center">Oracle</th>
                  <th className="text-center">UAT OK</th>
                </tr>
              </thead>
              <tbody>
                {listData.data.map(row => (
                  <tr key={row.code}>
                    <td>
                      <div className="font-medium text-primary text-xs">{row.banque}</div>
                      <div className="text-xs text-tertiary font-mono">{row.code}</div>
                    </td>
                    <td className="text-center font-semibold text-primary">{row.total_marchands}</td>
                    <td className="text-center">
                      <span className="badge badge-success text-xs">{row.en_production}</span>
                    </td>
                    <td className="text-center">
                      <span className="badge badge-warning text-xs">{row.en_cours}</span>
                    </td>
                    <td className="text-center text-xs text-tertiary">{row.en_attente}</td>
                    <td className="text-center">
                      <span className={clsx('badge text-xs', Number(row.oracle_prod) > 0 ? 'badge-success' : 'badge-neutral')}>
                        {row.oracle_prod}
                      </span>
                    </td>
                    <td className="text-center">
                      <span className={clsx('badge text-xs', Number(row.uat_ok) > 0 ? 'badge-info' : 'badge-neutral')}>
                        {row.uat_ok}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
