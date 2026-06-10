// src/components/transactions/TransactionKPIs.jsx
import { ArrowLeftRight, CheckCircle, XCircle, Play, MoreHorizontal, TrendingUp } from 'lucide-react';
import { StatCard, Spinner } from '@/components/ui';

const fmt    = (n) => n == null ? '—' : new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 }).format(n);
const fmtPct = (n, d) => (n != null && d > 0) ? `${(n / d * 100).toFixed(1)}%` : '';

export default function TransactionKPIs({ data, stats, statsLoading }) {
  if (!data?.total) return null;

  const total     = data.total;
  const loading   = statsLoading && stats == null;

  // Champs retournés par /api/transactions/stats — états Oracle exacts
  const deposited = stats?.deposited ?? null;  // payment_deposited
  const declined  = stats?.declined  ?? null;  // payment_declined
  const started   = stats?.started   ?? null;  // started
  const others    = stats?.others    ?? null;  // payment_void + reste

  const declinedPct  = fmtPct(declined,  total);
  const depositedPct = fmtPct(deposited, total);
  const startedPct   = fmtPct(started,   total);
  const othersPct    = fmtPct(others,    total);

  const declinedRate = declined != null && total > 0 ? declined / total * 100 : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">

      {/* Total */}
      <StatCard
        icon={ArrowLeftRight}
        label="Total transactions"
        value={total.toLocaleString('fr-FR')}
        sub="Sélection complète"
        accent="brand"
      />

      {/* payment_deposited */}
      <StatCard
        icon={CheckCircle}
        label="Déposées (OK)"
        value={loading ? <Spinner size={14}/> : fmt(deposited)}
        sub={loading ? 'Calcul…' : depositedPct}
        accent="success"
      />

      {/* payment_declined */}
      <StatCard
        icon={XCircle}
        label="Refusées"
        value={loading ? <Spinner size={14}/> : fmt(declined)}
        sub={loading ? 'Calcul…' : declinedPct}
        accent={declinedRate > 40 ? 'danger' : 'neutral'}
      />

      {/* started */}
      <StatCard
        icon={Play}
        label="Démarrées"
        value={loading ? <Spinner size={14}/> : fmt(started)}
        sub={loading ? 'Calcul…' : startedPct}
        accent="info"
      />

      {/* Autres états (payment_void + reste) */}
      <StatCard
        icon={MoreHorizontal}
        label="Autres états"
        value={loading ? <Spinner size={14}/> : fmt(others)}
        sub={loading ? 'Calcul…' : othersPct}
        accent="neutral"
      />
    </div>
  );
}
