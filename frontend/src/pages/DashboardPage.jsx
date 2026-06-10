// src/pages/DashboardPage.jsx — SMT COCKPIT Dashboard
import { useEffect, useState, useRef } from 'react';
import {
  ArrowLeftRight, Store, Database,
  Activity, Clock, AlertTriangle, Bell,
  Shield, Globe2, CheckCircle2, XCircle
} from 'lucide-react';
import client      from '@/api/client';
import useAuthStore from '@/store/authStore';
import clsx        from 'clsx';

const fmt    = n => (n ?? 0).toLocaleString('fr-FR');
const fmtPct = (n, d) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : '—';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [health,    setHealth]    = useState(null);
  const [tracking,  setTracking]  = useState(null);
  const [bpcStats,  setBpcStats]  = useState(null);  // transactions du jour
  const [acsData,   setAcsData]   = useState(null);  // ACS metrics
  const [swStats,   setSwStats]   = useState(null);  // PAYSMART du jour
  const [alerts,    setAlerts]    = useState([]);
  const [notifPerm, setNotifPerm] = useState(Notification?.permission || 'default');
  const notifiedRef = useRef(new Set());

  const today = new Date().toISOString().slice(0, 10);
  const todayFr = `${today.slice(8,10)}/${today.slice(5,7)}/${today.slice(0,4)}`;

  const now = new Date().toLocaleDateString('fr-FR', {
    weekday:'long', day:'numeric', month:'long', year:'numeric'
  });

  useEffect(() => {
    // Services health
    client.get('/health').then(r => setHealth(r.data)).catch(() => {});
    // Tracking pipeline
    client.get('/tracking/stats').then(r => setTracking(r.data)).catch(() => {});
    // BPC stats du jour
    client.post('/transactions/stats', { date_debut: todayFr, date_fin: todayFr })
      .then(r => setBpcStats(r.data)).catch(() => {});
    // ACS metrics
    client.get('/acs/metrics').then(r => {
      if (r.data?.success) setAcsData(r.data.data);
    }).catch(() => {});
    // PAYSMART — les deux appels ensemble pour éviter la race condition
    Promise.all([
      client.post('/switch/transactions', {
        date_debut: today, date_fin: today, page: 1, pageSize: 1, table_mode: 'new'
      }).catch(() => null),
      client.post('/switch/export', {
        date_debut: today, date_fin: today, table_mode: 'new'
      }).catch(() => null),
    ]).then(([txRes, expRes]) => {
      const total   = txRes?.data?.total   ?? null;
      const allData = expRes?.data?.success ? (expRes.data.data || []) : [];
      setSwStats({ total, allData });
    });
  }, []);

  // ── Calcul des métriques BPC ──────────────────────────────
  const bpcTotal     = bpcStats?.total     ?? null;
  const bpcDeposited = bpcStats?.deposited ?? null;  // payment_deposited
  const bpcDeclined  = bpcStats?.declined  ?? null;  // payment_declined
  const bpcStarted   = bpcStats?.started   ?? null;  // started
  const bpcOther     = bpcStats?.others    ?? null;  // payment_void + reste
  const declinedPct  = bpcTotal > 0 && bpcDeclined != null ? bpcDeclined / bpcTotal * 100 : 0;

  // ── Calcul des métriques ACS ──────────────────────────────
  const acsAreq      = acsData ? Object.values(acsData.timers?.['acs.3ds2.areq.incoming.timer'] || {}).find(k => k === 'count') || acsData.timers?.['acs.3ds2.areq.incoming.timer']?.count : null;
  const acsDs        = acsData ? (acsData.counters?.['acs.3ds2.ds.connection'] || {}).count : null;
  const acsAbandon   = acsData ? (acsData.counters?.['acs.3ds2.counter.challenge.abandon'] || {}).count : null;
  const acsSrvErr    = acsData ? (acsData.counters?.['acs.3ds2.counter.error.server'] || {}).count : null;
  const acsSrvErrPct = acsAreq > 0 && acsSrvErr    != null ? acsSrvErr    / acsAreq * 100 : 0;
  const acsAbandonPct= acsAreq > 0 && acsAbandon   != null ? acsAbandon   / acsAreq * 100 : 0;
  const acsDsPct     = acsAreq > 0 && acsDs        != null ? acsDs        / acsAreq * 100 : 0;
  // Seuils alertes ACS
  const ACS_ABANDON_SEUIL = 10;  // alerte si % abandons > 10%
  const ACS_DS_SEUIL      = 80;  // alerte si taux DS < 80%

  // ── Calcul des métriques PAYSMART ─────────────────────────
  const swTotal    = swStats?.total ?? null;
  const swAllData  = swStats?.allData || [];
  const swFacturiers = swAllData.length ? new Set(swAllData.map(r => r['Facturier']).filter(Boolean)).size : null;
  const swFsp        = swAllData.length ? new Set(swAllData.map(r => r['FSP']).filter(Boolean)).size        : null;
  const swPnr        = swAllData.length ? swAllData.filter(r => (r['Etat']||'').toUpperCase().includes('PNR')).length : null;
  const swPaid       = swAllData.length ? swAllData.filter(r => {
    const v = (r['Etat']||'').toUpperCase();
    return ['OK','SUCCESS','PAID','APPROVED','ACCEPTED','VALIDE','DEPOSITED'].some(s => v.includes(s));
  }).length : null;

  // ── Génération des alertes ────────────────────────────────
  useEffect(() => {
    const list = [];

    if (bpcTotal > 0 && declinedPct > 40)
      list.push({ id:'declined', level:'danger',  icon: XCircle,
        title: '⚠️ Taux de refus élevé',
        msg  : `${declinedPct.toFixed(1)}% de transactions CLICTOPAY refusées (seuil : 40%)` });

    if (acsAreq > 0 && acsSrvErrPct > 1)
      list.push({ id:'acs-err', level:'danger', icon: Shield,
        title: '⚠️ Erreurs serveur ACS',
        msg  : `${acsSrvErrPct.toFixed(2)}% d'erreurs serveur ACS (seuil : 1%)` });

    if (acsAreq > 0 && acsAbandonPct > ACS_ABANDON_SEUIL)
      list.push({ id:'acs-abandon', level:'warning', icon: Shield,
        title: '⚠️ Taux d\'abandons ACS élevé',
        msg  : `${acsAbandonPct.toFixed(1)}% d'abandons (seuil : ${ACS_ABANDON_SEUIL}%) — ${acsAbandon} abandon(s) sur ${acsAreq} AREQ` });

    if (acsAreq > 0 && acsDsPct < ACS_DS_SEUIL && acsDs != null)
      list.push({ id:'acs-ds', level:'warning', icon: Shield,
        title: '⚠️ Taux de connexions DS faible',
        msg  : `${acsDsPct.toFixed(1)}% de connexions DS (seuil minimum : ${ACS_DS_SEUIL}%) — ${acsDs} connexion(s) sur ${acsAreq} AREQ` });

    if (swPaid !== null && swPaid < 10)
      list.push({ id:'sw-paid', level:'warning', icon: Globe2,
        title: '⚠️ Peu de factures payées PAYSMART',
        msg  : `Seulement ${swPaid} facture(s) payée(s) aujourd'hui (seuil : 10)` });

    setAlerts(list);
  }, [bpcTotal, declinedPct, acsSrvErrPct, acsAbandonPct, acsDsPct, acsAreq, swPaid]);

  // ── Notifications browser ─────────────────────────────────
  useEffect(() => {
    alerts.forEach(alert => {
      if (notifiedRef.current.has(alert.id)) return;
      if (Notification?.permission === 'granted') {
        new Notification(`SMT COCKPIT — ${alert.title}`, { body: alert.msg, icon: '/favicon.svg' });
        notifiedRef.current.add(alert.id);
      }
    });
  }, [alerts]);

  const requestNotif = async () => {
    const perm = await Notification?.requestPermission?.();
    setNotifPerm(perm || 'denied');
  };

  return (
    <div className="space-y-5 animate-fade-in">

      {/* En-tête */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-primary">Bonjour, {user?.prenom} 👋</h1>
          <p className="text-sm text-tertiary mt-0.5 capitalize">{now}</p>
        </div>
        <div className="flex items-center gap-3">
          {notifPerm !== 'granted' && (
            <button onClick={requestNotif}
              className="btn-ghost btn-sm text-xs flex items-center gap-1.5">
              <Bell size={12}/> Activer les alertes
            </button>
          )}
          <div className="flex items-center gap-2 text-xs text-tertiary">
            <Clock size={12}/>
            <span>{new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })}</span>
          </div>
        </div>
      </div>

      {/* ── ALERTES ─────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <div className="section-title flex items-center gap-2">
            <AlertTriangle size={13} className="text-danger"/> Alertes actives ({alerts.length})
          </div>
          {alerts.map(alert => (
            <div key={alert.id} className={clsx(
              'flex items-start gap-3 rounded-lg px-4 py-3 border',
              alert.level === 'danger'
                ? 'bg-danger-dim border-danger/30'
                : 'bg-warning-dim border-warning/30'
            )}>
              <alert.icon size={16} className={alert.level === 'danger' ? 'text-danger shrink-0 mt-0.5' : 'text-warning shrink-0 mt-0.5'}/>
              <div>
                <div className={clsx('text-sm font-semibold', alert.level === 'danger' ? 'text-danger' : 'text-warning')}>
                  {alert.title}
                </div>
                <div className="text-xs text-secondary mt-0.5">{alert.msg}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── STATUT SERVICES ─────────────────────────────────── */}
      <div>
        <div className="section-title">Statut des services</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {health ? (
            Object.entries(health.services).map(([key, status]) => (
              <ServiceCard key={key} name={SERVICE_LABELS[key] || key} status={status}/>
            ))
          ) : Array(5).fill(0).map((_, i) => (
            <div key={i} className="card p-3 h-16 animate-pulse bg-surface2"/>
          ))}
        </div>
      </div>

      {/* ── KPIs CLICTOPAY ──────────────────────────────────── */}
      <div>
        <div className="section-title flex items-center gap-2">
          <ArrowLeftRight size={12}/> Transactions CLICTOPAY — Aujourd'hui
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Total transactions"  value={fmt(bpcTotal)}     accent="brand"   loading={bpcTotal === null}/>
          <KpiCard label="Déposées (OK)"
            value={fmt(bpcDeposited)}
            sub={fmtPct(bpcDeposited, bpcTotal)}
            accent="success" loading={bpcDeposited === null}/>
          <KpiCard label="Refusées"
            value={fmt(bpcDeclined)}
            sub={fmtPct(bpcDeclined, bpcTotal)}
            accent={declinedPct > 40 ? 'danger' : 'neutral'}
            loading={bpcDeclined === null}
            alert={declinedPct > 40}/>
          <KpiCard label="Démarrées"
            value={fmt(bpcStarted)}
            sub={fmtPct(bpcStarted, bpcTotal)}
            accent="info" loading={bpcStarted === null}/>
          <KpiCard label="Autres états"
            value={fmt(bpcOther)}
            sub={fmtPct(bpcOther, bpcTotal)}
            accent="neutral" loading={bpcOther === null}/>
        </div>
      </div>

      {/* ── KPIs ACS ────────────────────────────────────────── */}
      <div>
        <div className="section-title flex items-center gap-2">
          <Shield size={12}/> ACS Metrics 3DS2 — Cumul
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="AREQ reçus"
            value={fmt(acsAreq)}
            accent="brand"
            loading={!acsData && acsAreq === null}/>
          <KpiCard
            label="Connexions DS"
            value={fmt(acsDs)}
            sub={acsDsPct > 0 ? `${acsDsPct.toFixed(1)}% des AREQ` : ''}
            accent={acsAreq > 0 && acsDsPct < ACS_DS_SEUIL && acsDs != null ? 'warning' : 'success'}
            loading={!acsData && acsDs === null}
            alert={acsAreq > 0 && acsDsPct < ACS_DS_SEUIL && acsDs != null}/>
          <KpiCard
            label="Abandons"
            value={fmt(acsAbandon)}
            sub={acsAbandonPct > 0 ? `${acsAbandonPct.toFixed(1)}% des AREQ` : ''}
            accent={acsAbandonPct > ACS_ABANDON_SEUIL ? 'danger' : 'warning'}
            loading={!acsData && acsAbandon === null}
            alert={acsAbandonPct > ACS_ABANDON_SEUIL}/>
          <KpiCard
            label="Erreurs serveur"
            value={fmt(acsSrvErr)}
            sub={acsSrvErrPct > 0 ? `${acsSrvErrPct.toFixed(2)}% des AREQ` : ''}
            accent={acsSrvErrPct > 1 ? 'danger' : 'neutral'}
            loading={!acsData && acsSrvErr === null}
            alert={acsSrvErrPct > 1}/>
        </div>
      </div>

      {/* ── KPIs PAYSMART ───────────────────────────────────── */}
      <div>
        <div className="section-title flex items-center gap-2">
          <Globe2 size={12}/> PAYSMART SwitchBI — Aujourd'hui
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Total transactions" value={fmt(swTotal)}      accent="brand"   loading={swTotal === null}/>
          <KpiCard label="Facturiers actifs"  value={fmt(swFacturiers)} accent="info"    loading={swAllData.length === 0 && swTotal === null}/>
          <KpiCard label="FSP distincts"      value={fmt(swFsp)}        accent="neutral" loading={swAllData.length === 0 && swTotal === null}/>
          <KpiCard label="Transactions PNR"   value={fmt(swPnr)}        accent={swPnr > 0 ? 'warning' : 'neutral'} loading={swAllData.length === 0 && swTotal === null}/>
        </div>
      </div>

      {/* ── Pipeline marchands ──────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Store size={14} className="text-brand"/>
            <span className="text-sm font-semibold text-primary">Pipeline Marchands</span>
          </div>
          {tracking && (
            <span className="text-xs text-tertiary font-mono">
              {Object.values(tracking.pipeline || {}).reduce((a,b) => a+b, 0).toLocaleString('fr-FR')} total
            </span>
          )}
        </div>
        {tracking ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
            {PIPELINE_STEPS.map(({ key, label, color }) => {
              const n     = tracking.pipeline?.[key] || 0;
              const total = Object.values(tracking.pipeline || {}).reduce((a,b) => a+b, 0);
              const pct   = total > 0 ? Math.round(n / total * 100) : 0;
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className="text-xs text-tertiary w-40 truncate">{label}</div>
                  <div className="flex-1 h-1.5 bg-surface3 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${color}`}
                         style={{ width:`${pct}%`, transition:'width .6s ease' }}/>
                  </div>
                  <div className="text-xs font-mono text-secondary w-8 text-right">{n.toLocaleString('fr-FR')}</div>
                </div>
              );
            })}
          </div>
        ) : <Skeleton rows={7}/>}
      </div>
    </div>
  );
}

// ── Sous-composants ────────────────────────────────────────
function KpiCard({ label, value, sub, accent = 'neutral', loading = false, alert = false }) {
  const accents = {
    brand  : 'text-info',
    success: 'text-success',
    danger : 'text-danger',
    warning: 'text-warning',
    info   : 'text-info',
    neutral: 'text-secondary',
  };
  const bgs = {
    brand  : 'bg-info-dim',
    success: 'bg-success-dim',
    danger : 'bg-danger-dim',
    warning: 'bg-warning-dim',
    info   : 'bg-info-dim',
    neutral: 'bg-surface2',
  };
  return (
    <div className={clsx('card p-4 relative', alert && 'border-danger/40')}>
      {alert && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-danger animate-pulse"/>
      )}
      <div className="text-xs text-tertiary truncate">{label}</div>
      {loading ? (
        <div className="h-7 w-16 bg-surface3 rounded animate-pulse mt-1"/>
      ) : (
        <div className={clsx('text-xl font-semibold font-mono mt-0.5', accents[accent])}>
          {value ?? '—'}
        </div>
      )}
      {sub && <div className="text-xs text-tertiary mt-0.5">{sub}</div>}
    </div>
  );
}

function ServiceCard({ name, status }) {
  const ok = status === 'up';
  return (
    <div className="card p-3 flex items-center gap-2.5">
      <div className={clsx('w-2 h-2 rounded-full shrink-0', ok ? 'bg-success animate-pulse' : 'bg-danger')}/>
      <div>
        <div className="text-xs font-medium text-primary leading-tight">{name}</div>
        <div className={clsx('text-xs', ok ? 'text-success' : 'text-danger')}>{status}</div>
      </div>
    </div>
  );
}

function Skeleton({ rows = 4 }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array(rows).fill(0).map((_, i) => (
        <div key={i} className="h-4 bg-surface3 rounded" style={{ width:`${60+i*10}%` }}/>
      ))}
    </div>
  );
}

const SERVICE_LABELS = {
  postgresql  : 'PostgreSQL',
  oracle_bpc  : 'Oracle BPC',
  oracle_prod : 'Oracle PROD',
  oracle_test : 'Oracle TEST',
  sql_server  : 'SQL Server',
};

const PIPELINE_STEPS = [
  { key:'en_attente',         label:'En attente',        color:'bg-tertiary'   },
  { key:'prise_en_charge',    label:'Prise en charge',   color:'bg-info'       },
  { key:'recettes_envoyees',  label:'Recettes envoyées', color:'bg-warning'    },
  { key:'recettes_recues',    label:'Recettes reçues',   color:'bg-warning'    },
  { key:'valide',             label:'Validé',            color:'bg-success'    },
  { key:'banque_notifiee',    label:'Banque notifiée',   color:'bg-brand'      },
  { key:'en_production',      label:'En production',     color:'bg-success'    },
];



