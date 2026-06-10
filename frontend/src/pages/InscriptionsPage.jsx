// src/pages/InscriptionsPage.jsx — Registre Live Inscriptions Scolaires
// Design fidèle au modèle HTML validé (dashboard-inscriptions-scolaires_model.html)
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import client from '@/api/client';
import clsx from 'clsx';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, LabelList
} from 'recharts';
import {
  RefreshCw, Loader2, AlertCircle, Upload, Calendar,
  FileText, GraduationCap, TrendingUp, Banknote, CheckCircle2,
  Clock, Zap
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Palette cohérente avec le modèle ──────────────────────
const GOLD  = '#E8A33D';
const TEAL  = '#2BC5B4';
const CORAL = '#E5556B';
const MUTED = '#8B94A8';

const fmt    = n => (n||0).toLocaleString('fr-FR');
const fmtTND = n => `${fmt(Math.round(n||0))} TND`;
const fmtPct = n => `${(n||0).toFixed(1)}%`;

// ── KPI Card (fidèle au modèle .kpi) ──────────────────────
function KpiCard({ label, value, unit, delta, color = GOLD }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/8 p-5"
         style={{ background: 'var(--color-background-secondary)' }}>
      <div className="absolute right-[-30px] top-[-30px] w-24 h-24 rounded-full opacity-10"
           style={{ background: `radial-gradient(circle, ${color} 0%, transparent 70%)` }}/>
      <div className="text-[11px] uppercase tracking-[0.06em] mb-2.5" style={{ color: MUTED }}>{label}</div>
      <div className="text-[26px] font-semibold leading-none" style={{ color: 'var(--color-text-primary)' }}>
        {value}
        {unit && <span className="text-sm font-normal ml-1" style={{ color: MUTED }}>{unit}</span>}
      </div>
      {delta && (
        <div className="mt-2 text-[11.5px] flex gap-2 flex-wrap" style={{ color: MUTED }}>
          {delta}
        </div>
      )}
    </div>
  );
}

// ── Panel (fidèle au modèle .panel) ───────────────────────
function Panel({ title, sub, children, id, className = '' }) {
  return (
    <div id={id} className={clsx('rounded-xl border border-white/8 p-5', className)}
         style={{ background: 'var(--color-background-secondary)' }}>
      {(title || sub) && (
        <div className="flex items-center justify-between mb-4">
          <div>
            {title && <div className="font-semibold text-[14.5px] text-primary">{title}</div>}
            {sub   && <div className="text-[11px] mt-0.5" style={{ color: MUTED }}>{sub}</div>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

// ── Barre horizontale (hbar-row) ──────────────────────────
function HBar({ label, count, total, color = TEAL }) {
  const pct = total > 0 ? Math.round(count / total * 100) : 0;
  return (
    <div className="grid gap-2 items-center mb-2.5" style={{ gridTemplateColumns: '140px 1fr 52px', fontSize: 12 }}>
      <div className="truncate" style={{ color: MUTED }}>{label}</div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-background-tertiary)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }}/>
      </div>
      <div className="text-right font-mono text-primary">{fmt(count)}</div>
    </div>
  );
}

// ── Insight Banner (fidèle au modèle .insight) ────────────
function InsightBanner({ ins, kpi }) {
  if (!ins) return null;
  const psmCarte    = ins.psmCarteVia   || ins.psmCarte    || 0;
  const psmWallet   = ins.psmEnrolled   || ins.psmWallet   || 0;
  const psmVirement = ins.psmVirement   || 0;
  const psmTotal    = psmCarte + psmWallet + psmVirement;
  return (
    <div className="flex gap-3 items-start rounded-lg mb-6 p-3.5"
         style={{ background: 'linear-gradient(90deg, rgba(232,163,61,0.14), transparent 70%)',
                  border: '1px solid rgba(232,163,61,0.45)', borderLeft: '3px solid #E8A33D' }}>
      <span className="text-base mt-0.5">⚡</span>
      <div className="text-[13.5px] leading-snug" style={{ color: '#F0DFC0' }}>
        <b style={{ color: GOLD }}>{fmt(ins.enrolled)} élèves inscrits via SMT</b> —<br/>
        <b style={{ color: GOLD }}>{fmt(ins.ctpEnrolled)}</b> par cartes bancaires directement via ClicToPay ·{' '}
        <b style={{ color: GOLD }}>{fmt(psmTotal)}</b> via Paysmart :<br/>
        &nbsp;&nbsp;&nbsp;<b style={{ color: GOLD }}>{fmt(psmCarte)}</b> paiements par cartes via Paysmart à partir du site d'inscription.<br/>
        &nbsp;&nbsp;&nbsp;<b style={{ color: GOLD }}>{fmt(psmWallet)}</b> par wallet Mobile.
        {psmVirement > 0 && (<><br/>&nbsp;&nbsp;&nbsp;<b style={{ color: GOLD }}>{fmt(psmVirement)}</b> par virement.</>)}
        <br/>Canaux : <b style={{ color: GOLD }}>{fmt(ins.webCount)} WEB</b> · {fmt(ins.mobCount)} MOBILE · {fmt(ins.ussdCount)} USSD.
      </div>
    </div>
  );
}

export default function InscriptionsPage() {
  const today = new Date().toLocaleDateString('fr-FR');
  const [dateDebut, setDateDebut] = useState('20/08/2026');
  const [dateFin,   setDateFin]   = useState(today);
  const [params,    setParams]    = useState({ date_debut: '20/08/2026', date_fin: today });
  const [recoFile,  setRecoFile]  = useState(null);
  const [recoData,  setRecoData]  = useState(null);
  const [genPdf,    setGenPdf]    = useState(false);

  const { data: s, isLoading, error, isFetching } = useQuery({
    queryKey  : ['inscriptions-stats', params],
    queryFn   : () => client.post('/inscriptions/stats', params).then(r => r.data),
    staleTime : 0,
    retry     : 1,
  });

  const handleRefresh = () => setParams({ date_debut: dateDebut, date_fin: dateFin });

  const handleRapport = async () => {
    if (!s) { toast.error("Chargez d'abord les données"); return; }
    setGenPdf(true);
    try {
      const resp = await client.post('/inscriptions/rapport',
        { stats: s, format: 'pdf' },
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Rapport_Inscriptions_${new Date().toISOString().slice(0,10)}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Rapport PDF généré');
    } catch(e) {
      toast.error(e?.response?.data?.error || 'Erreur de génération');
    } finally { setGenPdf(false); }
  };

  const handleRecoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRecoFile(file.name);
    setRecoData({ total: '?', file: file.name });
  };

  const kpi = s?.kpis    || {};
  const tl  = s?.timeline || {};
  const ctp = s?.ctp     || {};
  const psm = s?.psm     || {};
  const ins = s?.insight  || {};

  // Données pour le graphique timeline
  const timelineData = (tl.buckets || []).map(b => ({
    label: b.label, ctp: b.ctp, psm: b.psm, total: b.ctp + b.psm
  }));

  // Réseaux CTP + FSP PSM combinés
  const networkData = [
    ...(ctp.networks || []).map(n => ({ name: n.name, count: n.count, color: GOLD, src: 'CTP' })),
    ...(psm.fsp      || []).map(n => ({ name: n.name, count: n.count, color: TEAL, src: 'PSM' })),
  ].sort((a,b) => b.count - a.count);

  const totalNetwork = networkData.reduce((s,n) => s + n.count, 0);

  // Analyse motifs d'échec
  const failTotal = (ctp.failByCategory?.timeout||0) + (ctp.failByCategory?.auth3ds||0) + (ctp.failByCategory?.banque||0);

  return (
    <div className="space-y-5">

      {/* ── HEADER ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm"
               style={{ background: `linear-gradient(155deg, ${GOLD}, #C97F1F)`, color: '#0A0F1C' }}>RS</div>
          <div>
            <div className="font-semibold text-sm text-primary">Registre Live</div>
            <div className="text-[11px]" style={{ color: MUTED }}>Inscriptions scolaires en ligne — Tunisie</div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Statut connexions */}
          {s && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: TEAL }}/>
              <span style={{ color: MUTED }}>{fmt(s.meta?.totalCtp)} CTP · {fmt(s.meta?.totalPsm)} PSM</span>
              {tl.launch && <span style={{ color: MUTED }}>· Lancement {tl.launch}</span>}
            </div>
          )}

          {/* Sélecteur de dates */}
          <div className="flex items-center gap-1 text-xs">
            <Calendar size={12} style={{ color: MUTED }}/>
            <input type="text" value={dateDebut} onChange={e => setDateDebut(e.target.value)}
              className="input w-24 text-xs h-7" placeholder="DD/MM/YYYY"/>
            <span style={{ color: MUTED }}>→</span>
            <input type="text" value={dateFin} onChange={e => setDateFin(e.target.value)}
              className="input w-24 text-xs h-7" placeholder="DD/MM/YYYY"/>
          </div>

          <button onClick={handleRefresh} disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: `${GOLD}22`, border: `1px solid ${GOLD}55`, color: GOLD }}>
            {isFetching ? <Loader2 size={12} className="animate-spin"/> : <RefreshCw size={12}/>}
            Actualiser
          </button>

          {s && (
            <button onClick={handleRapport} disabled={genPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}55`, color: TEAL }}>
              {genPdf ? <Loader2 size={12} className="animate-spin"/> : <FileText size={12}/>}
              📄 Exporter en PDF
            </button>
          )}
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div className="flex items-center gap-2 text-xs p-3 rounded-lg"
             style={{ background: `${CORAL}22`, border: `1px solid ${CORAL}44`, color: CORAL }}>
          <AlertCircle size={14}/> {error.response?.data?.error || error.message}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center h-48 gap-2 text-sm" style={{ color: MUTED }}>
          <Loader2 size={18} className="animate-spin"/> Chargement des données…
        </div>
      )}

      {/* ── SOURCE CARDS (upload bar) ──────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {[
          { icon: '🏦', label: 'ClicToPay', sub: s ? `${fmt(s.meta?.totalCtp)} transactions chargées` : 'Connexion Oracle BPC', loaded: !!s },
          { icon: '📱', label: 'Paysmart CNTE',  sub: s ? `${fmt(s.meta?.totalPsm)} transactions chargées` : 'Connexion SQL Server', loaded: !!s },
          { icon: '🏛️', label: 'Réconciliation Ministère', sub: recoFile || 'Déposez le fichier reçu', loaded: !!recoData, upload: true },
        ].map((src, i) => (
          <label key={i} className={clsx('flex items-center gap-3.5 rounded-xl p-4 border transition-colors cursor-pointer',
            src.loaded ? 'border-teal-500/30' : 'border-white/8')}
            style={{ background: 'var(--color-background-secondary)' }}>
            {src.upload && <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleRecoUpload}/>}
            <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center text-base border',
              src.loaded ? 'border-teal-500/30' : 'border-white/8')}
              style={{ background: src.loaded ? `${TEAL}22` : 'var(--color-background-tertiary)', fontSize: 16 }}>
              {src.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13.5px] text-primary">{src.label}</div>
              <div className="text-[11.5px] truncate mt-0.5" style={{ color: src.loaded ? TEAL : MUTED }}>{src.sub}</div>
            </div>
            <div className={clsx('w-2 h-2 rounded-full shrink-0', src.loaded ? 'bg-teal-400 shadow-[0_0_8px_rgba(43,197,180,0.6)]' : 'bg-gray-600')}/>
          </label>
        ))}
      </div>

      {s && (
        <>
          {/* ── INSIGHT BANNER ─────────────────────────── */}
          <InsightBanner ins={ins} kpi={kpi}/>

          {/* ── KPI GRID (5 colonnes comme le modèle) ──── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 mb-6">
            <KpiCard label="Élèves inscrits"     value={fmt(kpi.enrolled)}     color={GOLD}/>
            <KpiCard label="Montant encaissé"    value={fmt(Math.round(kpi.amount||0))} unit="TND" color={TEAL}/>
            <KpiCard label="Taux de succès"      value={fmtPct(kpi.successRate)}  color={TEAL}
                     delta={<span style={{ color: TEAL }}>Ajusté : {fmtPct(kpi.adjustedRate)}</span>}/>
            <KpiCard label="Sessions expirées"   value={fmt(kpi.timeoutCount)}  color={CORAL}
                     delta="Non finalisées dans le délai"/>
            <KpiCard label="Pic horaire"         value={fmt(tl.peak ? (tl.peak.ctp+tl.peak.psm) : 0)}
                     delta={tl.peak?.label} color={GOLD}/>
          </div>

          {/* Note écosystème */}
          <div className="text-[13px] leading-relaxed mb-5 pb-5 border-b border-white/8" style={{ color: MUTED }}>
            L'écosystème de paiement mobilise <b className="text-primary">23 banques</b> permettant à leurs clients
            de payer par carte bancaire et par wallet, ainsi que <b className="text-primary">7 établissements de paiement</b> proposant
            le paiement par wallet via leurs applications mobiles ou à travers leurs agents.
            Trois canaux de paiement sont utilisés : <b className="text-primary">WEB</b>, <b className="text-primary">Mobile</b> et <b className="text-primary">USSD</b>.
          </div>

          {/* ── MAIN GRID : Flux + Volume horaire ──────── */}
          <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 mb-4">
            {/* Flux en direct (ticker) */}
            <Panel title="Flux en direct" sub="Dernières transactions, combinées">
              <div className="space-y-0 overflow-hidden" style={{ maxHeight: 520, maskImage: 'linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 12px), transparent 100%)' }}>
                {[...Array(12)].map((_, i) => {
                  const src = i % 3 === 0 ? 'PSM' : 'CTP';
                  const ok  = i % 5 !== 3;
                  return (
                    <div key={i} className="flex items-center gap-2.5 py-2 border-b border-dashed border-white/8 text-xs">
                      <span className="font-mono w-14 shrink-0" style={{ color: MUTED }}>--:--</span>
                      <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', ok ? 'bg-teal-400' : 'bg-coral-400')}
                            style={{ background: ok ? TEAL : CORAL }}/>
                      <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold"
                            style={{ background: src==='CTP'?`${GOLD}22`:`${TEAL}22`, color: src==='CTP'?GOLD:TEAL }}>
                        {src}
                      </span>
                      <span className="flex-1 truncate" style={{ color: MUTED }}>—</span>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* Volume horaire */}
            <Panel title="Volume horaire" sub="Transactions par heure, par passerelle">
              <div className="flex gap-4 mb-3">
                {[{ color: GOLD, label: 'ClicToPay' }, { color: TEAL, label: 'Paysmart' }].map(l => (
                  <div key={l.label} className="flex items-center gap-1.5 text-[11.5px]" style={{ color: MUTED }}>
                    <span className="w-2 h-2 rounded-sm" style={{ background: l.color }}/>
                    {l.label}
                  </div>
                ))}
              </div>
              {timelineData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={timelineData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: MUTED }} axisLine={false} tickLine={false}
                           interval="preserveStartEnd"/>
                    <YAxis tick={{ fontSize: 9, fill: MUTED }} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, background: '#18223A', border: '1px solid rgba(255,255,255,0.1)' }}
                      formatter={(v, n) => [v, n === 'ctp' ? 'ClicToPay' : 'Paysmart']}/>
                    <Line type="monotone" dataKey="ctp" stroke={GOLD} strokeWidth={2} dot={{ r: 3, fill: GOLD }}/>
                    <Line type="monotone" dataKey="psm" stroke={TEAL} strokeWidth={2} dot={{ r: 3, fill: TEAL }}/>
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-xs" style={{ color: MUTED }}>
                  Aucune donnée de timeline
                </div>
              )}
              {tl.peak && (
                <div className="text-[11px] mt-2" style={{ color: MUTED }}>
                  Pic : <b className="text-primary">{tl.peak.label}</b> — {fmt(tl.peak.ctp + tl.peak.psm)} transactions
                </div>
              )}
            </Panel>
          </div>

          {/* ── RÉSEAUX & CANAUX ───────────────────────── */}
          <Panel title="Réseaux & canaux" sub="Répartition des transactions réussies" className="mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: GOLD }}>ClicToPay — Réseaux carte</div>
                {(ctp.networks || []).map((n, i) => (
                  <HBar key={i} label={n.name} count={n.count} total={ins.ctpEnrolled} color={GOLD}/>
                ))}
              </div>
              <div>
                <div className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: TEAL }}>Paysmart CNTE — Établissements</div>
                {(psm.fsp || []).map((n, i) => (
                  <HBar key={i} label={n.name} count={n.count} total={ins.psmEnrolled} color={TEAL}/>
                ))}
              </div>
            </div>
          </Panel>

          {/* ── MOTIFS D'ÉCHEC CTP ─────────────────────── */}
          {ctp.failReasons?.length > 0 && (
            <Panel title="Motifs d'échec — ClicToPay" sub="Détail complet des raisons de rejet" className="mb-4">
              {/* Catégories */}
              <div className="flex gap-4 mb-4 flex-wrap">
                {[
                  { key: 'timeout', label: 'Sessions expirées', color: GOLD },
                  { key: 'auth3ds', label: 'Échec 3D Secure',  color: '#8B5CF6' },
                  { key: 'banque',  label: 'Refus bancaire',    color: CORAL },
                ].map(cat => (
                  <div key={cat.key} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-sm" style={{ background: cat.color }}/>
                    <span style={{ color: MUTED }}>{cat.label} :</span>
                    <span className="font-semibold text-primary">{fmt(ctp.failByCategory?.[cat.key]||0)}</span>
                  </div>
                ))}
              </div>
              {/* Barre de composition */}
              <div className="h-3 rounded-full overflow-hidden flex gap-px mb-3">
                {[
                  { key:'timeout', color: GOLD },
                  { key:'auth3ds', color: '#8B5CF6' },
                  { key:'banque',  color: CORAL },
                ].map(cat => {
                  const pct = failTotal > 0 ? (ctp.failByCategory?.[cat.key]||0)/failTotal*100 : 0;
                  return <div key={cat.key} style={{ width:`${pct}%`, background: cat.color }} className="h-full"/>;
                })}
              </div>
              {/* Détail */}
              <div className="space-y-1 mt-4">
                {(ctp.failReasons || []).slice(0, 10).map((r, i) => (
                  <HBar key={i} label={r.reason?.slice(0,50)} count={r.count} total={failTotal} color={CORAL}/>
                ))}
              </div>
              {/* Analyse */}
              <div className="mt-4 p-3 rounded-lg text-xs leading-relaxed" style={{ background: `${CORAL}11`, border: `1px solid ${CORAL}33`, color: '#F0DFC0' }}>
                {ctp.failByCategory?.timeout > 0 && `${fmt(ctp.failByCategory.timeout)} sessions ont expiré (délai dépassé par l'usager). `}
                {ctp.failByCategory?.auth3ds  > 0 && `${fmt(ctp.failByCategory.auth3ds)} refus d'authentification 3D Secure (OTP non reçu ou expiré). `}
                {ctp.failByCategory?.banque   > 0 && `${fmt(ctp.failByCategory.banque)} refus directs par la banque émettrice.`}
              </div>
            </Panel>
          )}

          {/* ── DÉTAIL DU SUCCÈS CTP ───────────────────── */}
          <Panel title="Détail du succès — ClicToPay" sub="Avec et sans les sessions expirées" className="mb-4">
            <div className="flex items-stretch gap-4 mb-4 flex-wrap">
              <div className="flex-1 min-w-[200px] rounded-lg p-4" style={{ background: 'var(--color-background-tertiary)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-[11.5px] mb-2" style={{ color: MUTED }}>Taux de succès brut</div>
                <div className="text-[28px] font-semibold font-mono text-primary">{fmtPct(kpi.successRate)}</div>
                <div className="text-[10.5px] mt-2" style={{ color: MUTED }}>Approuvées / total des transactions</div>
              </div>
              <div className="flex items-center text-xl" style={{ color: MUTED }}>→</div>
              <div className="flex-1 min-w-[200px] rounded-lg p-4" style={{ background: `${TEAL}15`, border: `1px solid ${TEAL}45` }}>
                <div className="text-[11.5px] mb-2" style={{ color: MUTED }}>Taux hors sessions expirées</div>
                <div className="text-[28px] font-semibold font-mono" style={{ color: TEAL }}>{fmtPct(kpi.adjustedRate)}</div>
                <div className="text-[10.5px] mt-2" style={{ color: MUTED }}>Sessions expirées retirées du calcul</div>
              </div>
            </div>
            {/* Barre de composition */}
            <div className="h-6 rounded-lg overflow-hidden flex">
              {[
                { w: kpi.successRate, color: TEAL, label: 'Approuvées' },
                { w: kpi.timeoutCount/(kpi.total||1)*100, color: GOLD, label: 'Expirées' },
                { w: 100 - kpi.successRate - kpi.timeoutCount/(kpi.total||1)*100, color: CORAL, label: 'Refusées' },
              ].map((seg, i) => (
                <div key={i} className="h-full transition-all" style={{ width:`${Math.max(0,seg.w)}%`, background: seg.color }}/>
              ))}
            </div>
            <div className="flex gap-4 mt-2 flex-wrap">
              {[
                { color: TEAL, label: 'Approuvées', value: fmt(kpi.enrolled) },
                { color: GOLD, label: 'Sessions expirées', value: fmt(kpi.timeoutCount) },
                { color: CORAL, label: 'Refusées', value: fmt((kpi.total||0) - (kpi.enrolled||0) - (kpi.timeoutCount||0)) },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5 text-[11.5px]">
                  <span className="w-2 h-2 rounded-sm" style={{ background: l.color }}/>
                  <span style={{ color: MUTED }}>{l.label}</span>
                  <b className="text-primary font-mono">{l.value}</b>
                </div>
              ))}
            </div>
          </Panel>

          {/* ── PAYSMART ───────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Panel title="Paysmart — Répartition par moyen" sub="Détail du support de paiement utilisé">
              {(psm.moyen || []).map((m, i) => (
                <HBar key={i} label={m.name} count={m.count} total={ins.psmEnrolled} color={TEAL}/>
              ))}
            </Panel>

            <Panel title="Paysmart — Carte vs Wallet" sub="Regroupement par type de support">
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: 'Carte',  value: psm.carte,  icon: '💳', color: TEAL },
                  { label: 'Wallet', value: psm.wallet, icon: '📱', color: GOLD },
                ].map(t => (
                  <div key={t.label} className="text-center rounded-lg p-3" style={{ background: 'var(--color-background-tertiary)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="text-lg mb-1">{t.icon}</div>
                    <div className="text-[22px] font-mono font-semibold" style={{ color: t.color }}>{fmt(t.value)}</div>
                    <div className="text-[11px] mt-1" style={{ color: MUTED }}>{t.label}</div>
                  </div>
                ))}
              </div>
              {(psm.mode || []).map((m, i) => (
                <HBar key={i} label={m.name} count={m.count} total={ins.psmEnrolled} color={GOLD}/>
              ))}
            </Panel>
          </div>

          {/* ── CANAL ─────────────────────────────────── */}
          <Panel title="Paysmart — Répartition par canal" sub="WEB, MOBILE, USSD et non renseigné" className="mb-4">
            {(psm.canal || []).map((c, i) => (
              <HBar key={i} label={c.name} count={c.count} total={ins.psmEnrolled} color={TEAL}/>
            ))}
          </Panel>

          {/* ── RÉCONCILIATION ─────────────────────────── */}
          <Panel title="Réconciliation Ministère" sub="Fichier de référence officiel">
            {!recoData ? (
              <label className="flex flex-col items-center justify-center py-8 text-center cursor-pointer rounded-lg border-2 border-dashed border-white/14 hover:border-white/30 transition-colors">
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleRecoUpload}/>
                <div className="text-2xl mb-2">🏛️</div>
                <div className="font-medium text-primary text-sm mb-1">Déposez le fichier reçu</div>
                <div className="text-xs" style={{ color: MUTED }}>Fichier Excel ou CSV fourni par le Ministère</div>
                <div className="mt-3 px-4 py-1.5 rounded-lg text-xs border border-white/14 hover:border-white/30 text-primary">
                  Parcourir
                </div>
              </label>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${TEAL}22` }}>
                  🏛️
                </div>
                <div>
                  <div className="font-medium text-primary">{recoData.file}</div>
                  <div className="text-xs" style={{ color: MUTED }}>{fmt(recoData.total)} lignes chargées</div>
                </div>
                {typeof kpi.enrolled === 'number' && typeof recoData.total === 'number' && (
                  <div className={clsx('ml-auto text-xs font-semibold px-2 py-1 rounded', recoData.total === kpi.enrolled ? 'text-teal-400' : 'text-amber-400')}>
                    {recoData.total === kpi.enrolled ? '✓ Concordant' : `⚠ Écart : ${kpi.enrolled - recoData.total}`}
                  </div>
                )}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
