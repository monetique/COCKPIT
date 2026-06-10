// src/components/switch/SwitchKPIs.jsx
import { ArrowLeftRight, TrendingUp, CheckCircle, Store, Zap, ZapOff } from 'lucide-react';
import { StatCard } from '@/components/ui';

const fmt    = (n) => new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 }).format(n ?? 0);
const fmtTND = (n) => new Intl.NumberFormat('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n ?? 0) + ' TND';

export default function SwitchKPIs({ kpis }) {
  if (!kpis) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
      <StatCard icon={ArrowLeftRight} label="Total"          value={fmt(kpis.total)}              sub="Sélection complète"  accent="brand"/>
      <StatCard icon={TrendingUp}     label="Volume"         value={fmtTND(kpis.montant)}          sub="Montant total"       accent="success"/>
      <StatCard icon={TrendingUp}     label="Panier moyen"   value={fmtTND(kpis.moyen)}            sub="Par transaction"     accent="neutral"/>
      <StatCard icon={CheckCircle}    label="Taux succès"    value={`${kpis.succesRate}%`}          sub="États OK/validés"    accent={kpis.succesRate>=80?'success':kpis.succesRate>=50?'warning':'danger'}/>
      <StatCard icon={Store}          label="Facturiers"     value={fmt(kpis.facturiers)}           sub="Distincts"           accent="info"/>
      <StatCard icon={Zap}            label="Pic (/ min)"    value={fmt(kpis.picMax)}               sub="Max / minute"        accent="warning"/>
      <StatCard icon={ZapOff}         label="Creux (/ min)"  value={fmt(kpis.picMin)}               sub="Min / minute"        accent="neutral"/>
    </div>
  );
}
