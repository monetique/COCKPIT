// src/pages/AcsPage.jsx — ACS 3DS2 Metrics Dashboard
import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  RefreshCw, Upload, Radio, RadioTower, AlertTriangle,
  Shield, Activity, Wifi, WifiOff, Settings2
} from 'lucide-react';
import clsx   from 'clsx';
import toast  from 'react-hot-toast';
import { SectionHeader, StatCard, Spinner, EmptyState } from '@/components/ui';
import { getAcsMetrics } from '@/api/acs';
import { parseAcsMetrics, fmt, ms, pct } from '@/utils/acsParser';

const DEFAULT_URL = 'https://3ds2.clictopay.com/acs/metrics';
const TIP = { backgroundColor:'#181d2a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'8px', color:'#e8eaf0', fontSize:'11px' };
const PAL  = ['#3b82f6','#7c3aed','#059669','#d97706','#dc2626','#0891b2','#db2777','#ea580c','#16a34a','#9333ea','#2563eb','#0d9488','#b45309','#1d4ed8','#be123c'];

export default function AcsPage() {
  const qc = useQueryClient();
  const fileRef = useRef();

  const [apiUrl,     setApiUrl]     = useState(DEFAULT_URL);
  const [inputUrl,   setInputUrl]   = useState(DEFAULT_URL);
  const [autoRefresh,setAutoRefresh]= useState(false);
  const [fileData,   setFileData]   = useState(null); // données chargées depuis fichier
  const [showConfig, setShowConfig] = useState(false);
  const [activeTab,  setActiveTab]  = useState('kpi'); // kpi | banks | charts

  // ── Fetch métriques via backend proxy ──────────────────────
  const { data: apiResult, isFetching, error, refetch } = useQuery({
    queryKey    : ['acs-metrics', apiUrl],
    queryFn     : () => getAcsMetrics(apiUrl).then(r => r.data),
    staleTime   : 30_000,
    refetchInterval: autoRefresh ? 30_000 : false,
    retry       : 1,
  });

  // Utiliser les données fichier si disponibles, sinon API
  const rawData  = fileData || apiResult?.data;
  const source   = fileData ? 'Fichier JSON local' : (apiResult?.source || apiUrl);
  const fetchedAt= fileData ? new Date().toLocaleTimeString('fr-FR') : (apiResult?.fetchedAt ? new Date(apiResult.fetchedAt).toLocaleTimeString('fr-FR') : '—');
  const d        = rawData ? parseAcsMetrics(rawData) : null;
  const online   = !error && !!apiResult?.success;

  // ── Charger depuis fichier JSON ──────────────────────────
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        if (!json.counters && !json.timers) throw new Error('Structure metrics invalide');
        setFileData(json);
        toast.success(`✓ ${file.name} chargé`);
      } catch(err) {
        toast.error('Erreur : ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Appliquer URL ────────────────────────────────────────
  const applyUrl = () => {
    setApiUrl(inputUrl.trim());
    setFileData(null);
    qc.invalidateQueries({ queryKey: ['acs-metrics'] });
    setShowConfig(false);
  };

  const TABS = [
    { key:'kpi',    label:'KPIs & Alertes' },
    { key:'banks',  label:`Banques (${d?.bankCnt || 0})` },
    { key:'charts', label:'Graphiques' },
  ];

  return (
    <div className="space-y-4 animate-fade-in">

      {/* En-tête */}
      <SectionHeader title="ACS Metrics · 3DS2" sub={`Source : ${source} · ${fetchedAt}`}>
        {/* Statut */}
        <div className={clsx('flex items-center gap-1.5 text-xs',
          isFetching ? 'text-warning' : online ? 'text-success' : 'text-danger')}>
          {online ? <Wifi size={12}/> : <WifiOff size={12}/>}
          <span className={clsx('w-1.5 h-1.5 rounded-full',
            isFetching ? 'bg-warning animate-pulse'
            : online   ? 'bg-success animate-pulse'
            : 'bg-danger')}/>
          {isFetching ? 'Chargement…' : online ? 'En ligne' : 'Hors ligne'}
          {d && <span className="ml-1 text-tertiary">{d.rate.toFixed(3)} req/s</span>}
        </div>

        {/* Auto-refresh */}
        <button
          onClick={() => setAutoRefresh(v => !v)}
          className={clsx('btn-sm flex items-center gap-1.5', autoRefresh ? 'btn-primary' : 'btn-ghost')}
          title="Rafraîchissement automatique (30s)">
          <Radio size={12}/>
          {autoRefresh ? 'Auto 30s' : 'Manuel'}
        </button>

        {/* Refresh */}
        <button onClick={() => { setFileData(null); refetch(); }} disabled={isFetching}
          className="btn-ghost btn-sm">
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''}/>
        </button>

        {/* Charger fichier */}
        <button onClick={() => fileRef.current?.click()} className="btn-ghost btn-sm">
          <Upload size={13}/> JSON local
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile}/>

        {/* Config URL */}
        <button onClick={() => setShowConfig(v => !v)}
          className={clsx('btn-ghost btn-sm', showConfig && 'bg-surface3')}>
          <Settings2 size={13}/>
        </button>
      </SectionHeader>

      {/* Panneau configuration URL */}
      {showConfig && (
        <div className="card p-4 space-y-2 animate-fade-in">
          <div className="text-xs font-semibold text-secondary mb-2">URL de l'API ACS</div>
          <div className="flex gap-2">
            <input type="text" value={inputUrl} onChange={e => setInputUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyUrl()}
              className="input flex-1 text-xs font-mono"
              placeholder="https://3ds2.clictopay.com/acs/metrics"/>
            <button onClick={applyUrl} className="btn-primary btn-sm">Appliquer</button>
            <button onClick={() => setInputUrl(DEFAULT_URL)} className="btn-ghost btn-sm">Reset</button>
          </div>
          <div className="text-xs text-tertiary">
            L'appel passe par le backend pour éviter les problèmes CORS.
          </div>
        </div>
      )}

      {/* Erreur */}
      {error && !fileData && (
        <div className="card p-4 flex items-start gap-3 bg-danger-dim border border-danger/20">
          <WifiOff size={16} className="text-danger shrink-0 mt-0.5"/>
          <div>
            <div className="text-sm font-semibold text-danger">ACS inaccessible</div>
            <div className="text-xs text-secondary mt-1">{error.response?.data?.error || error.message}</div>
            <div className="text-xs text-tertiary mt-1.5">
              Configurez l'URL ou chargez un fichier JSON de métriques.
            </div>
          </div>
        </div>
      )}

      {/* Pas encore de données */}
      {!d && !isFetching && (
        <EmptyState
          title="Aucune donnée ACS"
          message="Cliquez sur Rafraîchir ou chargez un fichier JSON de métriques."
        />
      )}

      {/* Chargement initial */}
      {isFetching && !d && (
        <div className="card p-10 flex flex-col items-center gap-3">
          <Spinner size={24}/>
          <div className="text-xs text-tertiary">Récupération des métriques ACS…</div>
        </div>
      )}

      {/* Contenu principal */}
      {d && (
        <>
          {/* Onglets */}
          <div className="flex border-b border-border">
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={clsx('flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.key ? 'border-brand text-primary' : 'border-transparent text-tertiary hover:text-secondary')}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── KPIs & Alertes ──────────────────────────── */}
          {activeTab === 'kpi' && <KpiTab d={d}/>}

          {/* ── Tableau des banques ─────────────────────── */}
          {activeTab === 'banks' && <BanksTab d={d}/>}

          {/* ── Graphiques ──────────────────────────────── */}
          {activeTab === 'charts' && <ChartsTab d={d}/>}
        </>
      )}
    </div>
  );
}

/* ── KPIs & Alertes ──────────────────────────────────────── */
function KpiTab({ d }) {
  return (
    <div className="space-y-4">
      {/* KPIs principaux */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Activity}      label="AREQ reçus"      value={fmt(d.areqTotal)}  sub={`${d.rate.toFixed(3)} req/s`}        accent="brand"/>
        <StatCard icon={RadioTower}    label="Connexions DS"   value={fmt(d.dsTotal)}    sub={pct(d.dsOk, d.dsTotal) + ' succès'}   accent="success"/>
        <StatCard icon={Shield}        label="SMS OTP"         value={fmt(d.smsTotal)}   sub={`${fmt(d.smsBrow)} Browser · ${fmt(d.smsApp)} App`} accent="info"/>
        <StatCard icon={AlertTriangle} label="Abandons"        value={fmt(d.abandon)}    sub={pct(d.abandon, d.areqTotal)}          accent={d.abandon > 500 ? 'danger' : 'warning'}/>
        <StatCard icon={AlertTriangle} label="Erreurs serveur" value={fmt(d.srvErr)}     sub={pct(d.srvErr, d.areqTotal)}           accent={d.srvErr > 100 ? 'danger' : 'neutral'}/>
        <StatCard icon={Activity}      label="p50 AREQ"        value={ms(d.aT.p50)}      sub={`p99 = ${ms(d.aT.p99)}`}             accent="neutral"/>
      </div>

      {/* Alertes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label : 'Erreurs AREQ + Processing',
            value : fmt(d.areqErr + d.procErr),
            sub   : `${fmt(d.areqErr)} AREQ · ${fmt(d.procErr)} processing`,
            warn  : d.areqErr + d.procErr > 500,
          },
          {
            label : 'Taux d\'abandon',
            value : pct(d.abandon, d.areqTotal),
            sub   : `${fmt(d.abandon)} challenges abandonnés`,
            warn  : d.abandon / Math.max(d.areqTotal, 1) > 0.005,
          },
          {
            label : 'Succès DS',
            value : pct(d.dsOk, d.dsTotal),
            sub   : `${fmt(d.dsErrSum)} err · ${fmt(d.dsToSum)} timeout`,
            warn  : d.dsOk / Math.max(d.dsTotal, 1) < 0.97,
          },
          {
            label : 'Requêtes RBA',
            value : fmt(d.rbaTotal),
            sub   : `mean ${ms(d.rT.mean)} · p99 ${ms(d.rT.p99)}`,
            warn  : false,
          },
        ].map(({ label, value, sub, warn }) => (
          <div key={label} className={clsx('card p-4', warn && 'bg-danger-dim border-danger/20')}>
            <div className={clsx('text-xs text-tertiary mb-1', warn && 'text-danger/80')}>{label}</div>
            <div className={clsx('text-xl font-semibold font-mono', warn ? 'text-danger' : 'text-primary')}>{value}</div>
            <div className="text-xs text-tertiary mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      {/* Timers AREQ + DS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TimerCard title="Timer AREQ incoming" timer={d.aT} warn={false}/>
        <TimerCard title="Timer DS connection"  timer={d.dT} warn={true}/>
      </div>

      {/* Réseaux */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-4">Réseaux & Canal SMS</div>
        <div className="space-y-4">
          <NetworkBar label="VISA"       value={d.visaTotal} total={d.visaTotal + d.mcTotal} color="#3b82f6"/>
          <NetworkBar label="MASTERCARD" value={d.mcTotal}   total={d.visaTotal + d.mcTotal} color="#7c3aed"/>
          <div className="border-t border-border pt-4 mt-2">
            <div className="text-xs font-semibold text-tertiary uppercase tracking-wide mb-3">Canal SMS OTP</div>
            <NetworkBar label="Browser"    value={d.smsBrow} total={d.smsBrow + d.smsApp} color="#3b82f6"/>
            <div className="mt-2">
              <NetworkBar label="App Mobile" value={d.smsApp}  total={d.smsBrow + d.smsApp} color="#7c3aed"/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Timer card ──────────────────────────────────────────── */
function TimerCard({ title, timer: t, warn }) {
  if (!t || t.count == null) return null;
  const rows = [
    { k:'p50', pct:7,   color: warn ? '#3b82f6' : '#3b82f6' },
    { k:'p75', pct:40,  color: '#6366f1' },
    { k:'p95', pct:warn?84:45, color: warn ? '#ea580c' : '#8b5cf6' },
    { k:'p98', pct:warn?91:51, color: warn ? '#dc2626' : '#d97706' },
    { k:'p99', pct:warn?94:69, color: warn ? '#b91c1c' : '#ea580c' },
    { k:'max', pct:100, color: '#7f1d1d' },
  ];
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide">{title}</div>
        <span className="text-xs text-tertiary">{fmt(t.count)} calls · ±{ms(t.stddev)}</span>
      </div>
      <div className="space-y-1.5">
        {rows.map(({ k, pct: width, color }) => (
          <div key={k} className="flex items-center gap-2">
            <div className="text-xs font-mono text-tertiary w-8">{k}</div>
            <div className="flex-1 h-1.5 bg-surface3 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                   style={{ width: `${width}%`, background: color }}/>
            </div>
            <div className="text-xs font-mono w-16 text-right" style={{ color }}>
              {t[k] != null ? `${(t[k] * 1000).toFixed(0)} ms` : '—'}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-border text-center">
        {[
          { label:'Moyenne', v: ms(t.mean),   color: warn ? '#f59e0b' : '#3b82f6' },
          { label:'Min',     v: ms(t.min),    color: '#10b981' },
          { label:'Max',     v: ms(t.max),    color: '#f87171' },
          { label:'Std Dev', v: `±${ms(t.stddev)}`, color: warn ? '#f87171' : '#8b92a5' },
        ].map(({ label, v, color }) => (
          <div key={label}>
            <div className="text-sm font-semibold font-mono" style={{ color }}>{v}</div>
            <div className="text-xs text-tertiary">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Network bar ─────────────────────────────────────────── */
function NetworkBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="text-xs font-semibold w-24" style={{ color }}>{label}</div>
      <div className="flex-1 h-2 bg-surface3 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
             style={{ width: `${pct.toFixed(1)}%`, background: color }}/>
      </div>
      <div className="text-xs font-mono text-secondary w-28 text-right">
        {fmt(value)} <span className="text-tertiary">({pct.toFixed(1)}%)</span>
      </div>
    </div>
  );
}

/* ── Tableau des banques ─────────────────────────────────── */
function BanksTab({ d }) {
  const maxDs = d.ranked[0]?.[1]?.ds || 1;

  return (
    <div className="card overflow-hidden">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Profil / Banque</th>
              <th className="text-right">DS Total</th>
              <th className="text-right" style={{color:'#3b82f6'}}>VISA</th>
              <th className="text-right" style={{color:'#7c3aed'}}>MC</th>
              <th className="text-right" style={{color:'#10b981'}}>OK</th>
              <th className="text-right" style={{color:'#f87171'}}>Err</th>
              <th className="text-right" style={{color:'#f59e0b'}}>Timeout</th>
              <th className="text-right">Taux err</th>
              <th className="text-right" style={{color:'#f87171'}}>AREQ err</th>
              <th className="text-right" style={{color:'#f59e0b'}}>Proc err</th>
              <th className="text-right" style={{color:'#10b981'}}>SMS</th>
              <th className="text-right" style={{color:'#7c3aed'}}>RBA</th>
            </tr>
          </thead>
          <tbody>
            {d.ranked.map(([bank, v], i) => {
              const errRate = v.ds > 0 ? (v.err + v.to) / v.ds * 100 : 0;
              const errColor = errRate > 0.10 ? 'text-danger font-semibold'
                             : errRate > 0.06 ? 'text-warning font-semibold'
                             : 'text-success';
              return (
                <tr key={bank}>
                  <td className="font-mono text-xs text-tertiary">{String(i+1).padStart(2,'0')}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-primary">{bank}</span>
                      <div className="flex-1 max-w-[80px] h-1 bg-surface3 rounded-full overflow-hidden">
                        <div className="h-full bg-brand rounded-full"
                             style={{ width: `${(v.ds/maxDs*100).toFixed(1)}%` }}/>
                      </div>
                    </div>
                  </td>
                  <td className="text-right font-mono text-xs font-semibold text-primary">{fmt(v.ds)}</td>
                  <td className="text-right font-mono text-xs" style={{color:'#3b82f6'}}>{fmt(v.visa)}</td>
                  <td className="text-right font-mono text-xs" style={{color:'#7c3aed'}}>{fmt(v.mc)}</td>
                  <td className="text-right font-mono text-xs text-success">{fmt(v.ok)}</td>
                  <td className="text-right font-mono text-xs text-danger">{fmt(v.err)}</td>
                  <td className="text-right font-mono text-xs text-warning">{fmt(v.to)}</td>
                  <td className={clsx('text-right font-mono text-xs', errColor)}>{errRate.toFixed(3)}%</td>
                  <td className="text-right font-mono text-xs text-danger">{fmt(v.ae)}</td>
                  <td className="text-right font-mono text-xs text-warning">{fmt(v.pe)}</td>
                  <td className="text-right font-mono text-xs text-success">{fmt(v.sms)}</td>
                  <td className="text-right font-mono text-xs" style={{color:'#7c3aed'}}>{fmt(v.rba)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Graphiques ──────────────────────────────────────────── */
function ChartsTab({ d }) {
  const t15 = d.ranked.slice(0, 15);
  const t10 = d.ranked.slice(0, 10);

  const volData    = t15.map(([b, v]) => ({ name: b, ds: v.ds }));
  const areqData   = [...d.ranked].sort((a,b)=>b[1].ae-a[1].ae).slice(0,10).map(([b,v])=>({ name:b, val:v.ae||0 }));
  const procData   = [...d.ranked].sort((a,b)=>b[1].pe-a[1].pe).slice(0,10).map(([b,v])=>({ name:b, val:v.pe||0 }));
  const smsData    = [...d.ranked].sort((a,b)=>b[1].sms-a[1].sms).slice(0,10).map(([b,v])=>({ name:b, val:v.sms||0 }));
  const rbaData    = t10.map(([b,v]) => ({ name: b, val: v.rba||0 }));
  const networkPie = [
    { name:'VISA',       value: d.visaTotal },
    { name:'MASTERCARD', value: d.mcTotal   },
  ];

  return (
    <div className="space-y-4">
      {/* Volume DS par banque */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
          Volume DS — Top 15 banques
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={volData} barSize={22}>
            <XAxis dataKey="name" tick={{ fontSize:9, fill:'#565e73' }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fontSize:9, fill:'#565e73' }} axisLine={false} tickLine={false} width={40}
                   tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}/>
            <Tooltip contentStyle={TIP} formatter={v => [fmt(v), 'Connexions DS']}/>
            <Bar dataKey="ds" radius={[4,4,0,0]}>
              {volData.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} fillOpacity={0.85}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Répartition réseau + Erreurs AREQ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
            Répartition réseau
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={networkPie} dataKey="value" nameKey="name"
                   cx="50%" cy="50%" outerRadius={70} innerRadius={35} paddingAngle={4}>
                <Cell fill="#3b82f6"/>
                <Cell fill="#7c3aed"/>
              </Pie>
              <Tooltip contentStyle={TIP} formatter={v => fmt(v)}/>
              <Legend iconType="circle" iconSize={8}
                formatter={v => <span style={{ fontSize:11, color:'#8b92a5' }}>{v}</span>}/>
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
            Erreurs AREQ — Top 10
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={areqData} layout="vertical" barSize={12}>
              <XAxis type="number" tick={{ fontSize:9, fill:'#565e73' }} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={60} tick={{ fontSize:9, fill:'#8b92a5', fontFamily:'DM Mono' }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={TIP} formatter={v => [fmt(v), 'Erreurs AREQ']}/>
              <Bar dataKey="val" fill="#dc2626" fillOpacity={0.7} radius={[0,3,3,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Erreurs processing + SMS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
            Erreurs processing — Top 10
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={procData} layout="vertical" barSize={12}>
              <XAxis type="number" tick={{ fontSize:9, fill:'#565e73' }} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={60} tick={{ fontSize:9, fill:'#8b92a5', fontFamily:'DM Mono' }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={TIP} formatter={v => [fmt(v), 'Erreurs processing']}/>
              <Bar dataKey="val" fill="#d97706" fillOpacity={0.7} radius={[0,3,3,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
            SMS OTP — Top 10
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={smsData} layout="vertical" barSize={12}>
              <XAxis type="number" tick={{ fontSize:9, fill:'#565e73' }} axisLine={false} tickLine={false}
                     tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}/>
              <YAxis type="category" dataKey="name" width={60} tick={{ fontSize:9, fill:'#8b92a5', fontFamily:'DM Mono' }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={TIP} formatter={v => [fmt(v), 'SMS OTP']}/>
              <Bar dataKey="val" fill="#059669" fillOpacity={0.7} radius={[0,3,3,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* RBA */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
          Requêtes RBA — Top 10
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={rbaData} barSize={22}>
            <XAxis dataKey="name" tick={{ fontSize:9, fill:'#565e73' }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fontSize:9, fill:'#565e73' }} axisLine={false} tickLine={false} width={40}
                   tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}/>
            <Tooltip contentStyle={TIP} formatter={v => [fmt(v), 'RBA']}/>
            <Bar dataKey="val" radius={[4,4,0,0]}>
              {rbaData.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} fillOpacity={0.75}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
