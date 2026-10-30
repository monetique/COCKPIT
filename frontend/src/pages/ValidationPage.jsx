// src/pages/ValidationPage.jsx
import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient }      from '@tanstack/react-query';
import * as XLSX  from 'xlsx';
import toast      from 'react-hot-toast';
import clsx       from 'clsx';
import {
  Upload, RefreshCw, Download, History,
  FileText, Bell, Landmark, Rocket, RotateCcw, FolderOpen,
  Play, CheckCircle2, XCircle, Loader2, AlertCircle, Zap, Send
} from 'lucide-react';

import { SectionHeader, StatCard, Spinner, EmptyState, Skeleton } from '@/components/ui';
import { VerdictBlock, VerdictBadge } from '@/components/validation/VerdictBadge';
import CasesTable               from '@/components/validation/CasesTable';
import NotifyMerchantModal      from '@/components/validation/NotifyMerchantModal';
import ProdEmailModal           from '@/components/validation/ProdEmailModal';
import { analyzeWorkbook }      from '@/utils/validationEngine';
import { getValidations, saveValidation, getValidationStats } from '@/api/validation';
import { getBankByCode }        from '@/api/merchants';
import { notifyBank, markBankNotified } from '@/api/validation';
import client from '@/api/client';
import CahiersInbox             from '@/components/validation/CahiersInbox';

export default function ValidationPage() {
  const qc = useQueryClient();

  // ── État ────────────────────────────────────────────
  const [result,        setResult]        = useState(null);
  const [validationId,  setValidationId]  = useState(null);
  const [dragging,      setDragging]      = useState(false);
  const [autoRunning,   setAutoRunning]   = useState(false);
  const [autoResults,   setAutoResults]   = useState(null);
  const [sendingRapport, setSendingRapport] = useState(false);
  const [analyzing,     setAnalyzing]     = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [activeTab,     setActiveTab]     = useState('analyse'); // 'analyse' | 'history'
  const [showNotify,    setShowNotify]    = useState(false);
  const [showProd,      setShowProd]      = useState(false);
  const [bankNotifying, setBankNotifying] = useState(false);
  const fileRef = useRef();

  // ── Requêtes ─────────────────────────────────────────
  const historyQuery = useQuery({
    queryKey: ['validations'],
    queryFn : () => getValidations({ limit: 30 }).then(r => r.data),
    staleTime: 30_000,
  });
  const statsQuery = useQuery({
    queryKey: ['validation-stats'],
    queryFn : () => getValidationStats().then(r => r.data),
    staleTime: 30_000,
  });

  // ── Analyser depuis l'inbox ─────────────────────────
  const handleAnalyzeFromInbox = useCallback((wb, filename) => {
    setAnalyzing(true);
    setResult(null);
    setValidationId(null);
    setActiveTab('analyse');
    try {
      const r = analyzeWorkbook(XLSX, wb, filename);
      setResult(r);
    } catch(err) {
      toast.error('Erreur analyse : ' + err.message);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  // ── Import fichier ───────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file || !file.name.match(/\.(xlsx|xls)$/i)) {
      toast.error('Format invalide — .xlsx ou .xls requis');
      return;
    }
    setAnalyzing(true);
    setResult(null);
    setValidationId(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const r  = analyzeWorkbook(XLSX, wb, file.name);
        setResult(r);
        setActiveTab('analyse');

        // Sauvegarder automatiquement en base si non vierge
        if (!r.isBlankTemplate && r.merchant.processingId) {
          setSaving(true);
          try {
            const { data } = await saveValidation({
              processing_id  : r.merchant.processingId,
              raison_sociale : r.merchant.raisonSociale,
              terminal_id    : r.merchant.terminalId,
              email_marchand : r.merchant.email,
              filename       : file.name,
              verdict        : r.verdict,
              total_cas      : r.total,
              cas_reussis    : r.pass,
              cas_echoues    : r.fail,
              cas_en_attente : r.pending,
              critiques_reussis: r.criticalPass,
              taux_reussite  : r.total ? Math.round(r.pass / r.total * 100) : 0,
              cases_json     : r.cases,
              anomalies_json : r.anomalies,
            });
            setValidationId(data.id);
            qc.invalidateQueries({ queryKey: ['validations'] });
            qc.invalidateQueries({ queryKey: ['validation-stats'] });
          } catch(e) {
            console.warn('Sauvegarde validation:', e.message);
          } finally {
            setSaving(false);
          }
        }
      } catch(err) {
        toast.error('Erreur analyse : ' + err.message);
      } finally {
        setAnalyzing(false);
      }
    };
    reader.readAsBinaryString(file);
  }, [qc]);

  const onDrop  = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); };
  const onInput = (e) => handleFile(e.target.files[0]);

  // ── Résoudre siteUrl depuis la DB (source de vérité) ─
  const resolveSiteUrl = async (pid) => {
    try {
      const { data } = await client.get(`/tracking/${pid}`);
      return data?.dossier?.site_url || data?.dossier?.site_web || '';
    } catch { return ''; }
  };

  // ── Notifier la banque ───────────────────────────────
  const handleNotifyBank = async () => {
    if (!result) return;
    const pid = result.merchant.processingId;
    setBankNotifying(true);
    try {
      const { data: bankData } = await getBankByCode(pid);
      if (!bankData.bank) { toast.error('Banque introuvable pour ce Processing ID'); return; }

      // Toujours utiliser site_url depuis la DB — source de vérité
      const siteUrl = await resolveSiteUrl(pid);

      await notifyBank({
        processingId: pid,
        merchantName: result.merchant.raisonSociale,
        terminalId  : result.merchant.terminalId,
        siteUrl,
        bankEmail   : bankData.bank.email,
        bankName    : bankData.bank.name,
      });
      if (validationId) {
        await markBankNotified(validationId, {
          bank_name : bankData.bank.name,
          bank_email: bankData.bank.email,
        });
        qc.invalidateQueries({ queryKey: ['validations'] });
      }
      toast.success(`🏦 ${bankData.bank.name} notifiée — ${bankData.bank.email}`);
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur notification banque');
    } finally {
      setBankNotifying(false);
    }
  };

  const reset = () => { setResult(null); setValidationId(null); setAutoResults(null); };

  // ── Exécution automatique des cas de test ────────────
  const handleAutoRun = async () => {
    if (!result?.merchant?.apiUser || !result?.merchant?.apiPwd) {
      toast.error('Credentials API introuvables dans le cahier');
      return;
    }
    setAutoRunning(true);
    setAutoResults(null);
    try {
      const { data } = await client.post('/validations/auto-run', {
        userName : result.merchant.apiUser,
        password : result.merchant.apiPwd,
        apiUrl   : result.merchant.apiUrl || undefined,
      });
      setAutoResults(data);
      toast.success(`✅ ${data.summary.pass} réussi · ❌ ${data.summary.fail} échoué`, { duration: 5000 });
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur exécution automatique');
    } finally {
      setAutoRunning(false);
    }
  };

  // ── Envoyer le rapport de validation ────────────────
  const handleSendRapport = async () => {
    if (!validationId) {
      toast.error('Sauvegardez d\'abord la validation pour générer un rapport');
      return;
    }
    setSendingRapport(true);
    try {
      const { data } = await client.post(`/validations/${validationId}/send-rapport`);
      toast.success(
        `📋 Rapport envoyé → ${data.sentTo}${data.cc?.length ? ` + ${data.cc.length} CC` : ''}`,
        { duration: 5000 }
      );
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur envoi rapport');
    } finally {
      setSendingRapport(false);
    }
  };

  // ── Stats ────────────────────────────────────────────
  const stats = statsQuery.data;
  const verdictCount = (v) => stats?.verdicts?.find(x => x.verdict === v)?.n || 0;

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader title="Validation des Recettes" sub="Analyse cahier · Verdict · Notifications">
        <button onClick={() => setActiveTab('history')}
          className={clsx('btn-ghost btn-sm', activeTab === 'history' && 'btn-primary')}>
          <History size={13}/> Historique ({stats?.total || 0})
        </button>
        <button onClick={() => { qc.invalidateQueries({ queryKey: ['validations'] }); qc.invalidateQueries({ queryKey: ['validation-stats'] }); }}
          className="btn-ghost btn-sm">
          <RefreshCw size={13}/>
        </button>
      </SectionHeader>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={FileText}  label="Total validations" value={stats?.total ?? '…'} accent="brand"/>
        <StatCard icon={FileText}  label="Approuvées"  value={verdictCount('approved')} accent="success"/>
        <StatCard icon={FileText}  label="Refusées"    value={verdictCount('refused')}  accent="danger"/>
        <StatCard icon={FileText}  label="Incomplètes" value={verdictCount('pending')}  accent="warning"/>
      </div>

      {/* Onglets */}
      <div className="flex border-b border-border">
        {[
          { key: 'inbox',   label: `Boîte de réception`,   icon: FolderOpen },
          { key: 'analyse', label: 'Analyse manuelle',      icon: FileText  },
          { key: 'auto',    label: 'Exécution auto',        icon: Zap       },
          { key: 'history', label: 'Historique',            icon: History   },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={clsx('flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key ? 'border-brand text-primary' : 'border-transparent text-tertiary hover:text-secondary')}>
            <tab.icon size={14}/>{tab.label}
          </button>
        ))}
      </div>

      {/* ── Onglet Inbox ────────────────────────────── */}
      {activeTab === 'inbox' && (
        <CahiersInbox onAnalyze={handleAnalyzeFromInbox}/>
      )}

      {/* ── Onglet Analyse ──────────────────────────── */}
      {activeTab === 'analyse' && (
        <>
          {/* Zone drop */}
          {!result && !analyzing && (
            <div onDragOver={e => { e.preventDefault(); setDragging(true); }}
                 onDragLeave={() => setDragging(false)} onDrop={onDrop}
                 onClick={() => fileRef.current?.click()}
                 className={clsx('card p-10 flex flex-col items-center gap-3 cursor-pointer border-2 border-dashed transition-all',
                   dragging ? 'border-brand bg-brand/5' : 'border-border hover:border-border2 hover:bg-surface2')}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onInput}/>
              <div className={clsx('w-14 h-14 rounded-2xl flex items-center justify-center', dragging ? 'bg-brand/20' : 'bg-surface3')}>
                <Upload size={22} className={dragging ? 'text-brand' : 'text-tertiary'}/>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-primary">Déposer le cahier des recettes Excel</div>
                <div className="text-xs text-tertiary mt-1">
                  Glissez-déposez ou cliquez · .xlsx uniquement
                </div>
                <div className="text-xs text-tertiary/60 mt-2">
                  Fichier généré par ClicToPay — feuilles "Informations" et "Cas de Test" requises
                </div>
              </div>
            </div>
          )}

          {analyzing && (
            <div className="card p-12 flex flex-col items-center gap-3">
              <Spinner size={28}/><div className="text-xs text-tertiary">Analyse en cours…</div>
            </div>
          )}

          {result && !analyzing && (
            <>
              {/* Barre d'actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={reset} className="btn-ghost btn-sm">
                  <RotateCcw size={13}/> Nouveau fichier
                </button>
                {saving && <span className="text-xs text-tertiary flex items-center gap-1"><Spinner size={12}/> Sauvegarde…</span>}
                {validationId && !saving && <span className="text-xs text-success">✓ Sauvegardé</span>}

                {/* Actions APPROUVÉ uniquement */}
                {result.verdict === 'approved' && !result.isBlankTemplate && (
                  <>
                    <button onClick={() => setShowNotify(true)} className="btn-ghost btn-sm ml-auto">
                      <Bell size={13}/> Notifier marchand
                    </button>
                    <button onClick={handleNotifyBank} disabled={bankNotifying} className="btn-success btn-sm">
                      {bankNotifying ? <Spinner size={13}/> : <Landmark size={13}/>}
                      Notifier banque
                    </button>
                    <button onClick={() => setShowProd(true)} className="btn-primary btn-sm">
                      <Rocket size={13}/> Email production
                    </button>
                  </>
                )}
                {/* Notification marchand pour refus aussi */}
                {result.verdict !== 'approved' && !result.isBlankTemplate && (
                  <button onClick={() => setShowNotify(true)} className="btn-ghost btn-sm ml-auto">
                    <Bell size={13}/> Notifier marchand
                  </button>
                )}
                {/* Rapport de validation — tous les verdicts */}
                {!result.isBlankTemplate && validationId && (
                  <button
                    onClick={handleSendRapport}
                    disabled={sendingRapport}
                    title="Envoyer le rapport PDF de validation au marchand et à la banque"
                    className={clsx(
                      'btn-sm flex items-center gap-1.5',
                      result.verdict === 'approved' ? 'btn-ghost' : 'btn-warning'
                    )}>
                    {sendingRapport ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>}
                    {sendingRapport ? 'Envoi…' : 'Rapport'}
                  </button>
                )}
              </div>

              {/* Verdict */}
              <VerdictBlock result={result} />

              {!result.isBlankTemplate && (
                <>
                  {/* Infos marchand */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      ['Processing ID', result.merchant.processingId, 'font-mono text-brand'],
                      ['Raison sociale', result.merchant.raisonSociale, ''],
                      ['Terminal ID',   result.merchant.terminalId,  'font-mono'],
                      ['Email',         result.merchant.email,       'text-tertiary'],
                    ].map(([label, value, cls]) => value && (
                      <div key={label} className="card p-3">
                        <div className="text-xs text-tertiary mb-0.5">{label}</div>
                        <div className={clsx('text-sm font-medium text-primary truncate', cls)}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* KPIs */}
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                    {[
                      { label:'Total',     value:result.total,                      accent:'brand'   },
                      { label:'Réussis',   value:result.pass,                       accent:'success' },
                      { label:'Échoués',   value:result.fail,                       accent:'danger'  },
                      { label:'En attente',value:result.pending,                    accent:'warning' },
                      { label:'Taux',      value:`${result.total ? Math.round(result.pass/result.total*100) : 0}%`, accent:'neutral' },
                      { label:'Critiques', value:`${result.criticalPass}/${result.criticalTotal}`, accent:result.criticalPass===result.criticalTotal?'success':'danger' },
                    ].map(s => (
                      <StatCard key={s.label} label={s.label} value={s.value} accent={s.accent}/>
                    ))}
                  </div>

                  {/* Anomalies */}
                  {result.anomalies.length > 0 && (
                    <div className="card p-4 space-y-1.5">
                      <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">
                        Anomalies détectées ({result.anomalies.length})
                      </div>
                      {result.anomalies.map((a, i) => (
                        <div key={i} className={clsx('flex items-start gap-2 text-xs',
                          a.type === 'error' ? 'text-danger' : 'text-warning')}>
                          <span className="shrink-0">{a.type === 'error' ? '❌' : '⚠️'}</span>
                          <span>{a.msg}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tableau des cas */}
                  <CasesTable cases={result.cases} merchant={result.merchant} />
                </>
              )}
            </>
          )}
        </>
      )}

      {/* ── Onglet Exécution auto ─────────────────────── */}
      {activeTab === 'auto' && (
        <AutoRunPanel
          result={result}
          autoResults={autoResults}
          autoRunning={autoRunning}
          onRun={handleAutoRun}
          onSwitchToAnalyse={() => setActiveTab('analyse')}
        />
      )}

      {/* ── Onglet Historique ────────────────────────── */}
      {activeTab === 'history' && (
        <div className="card overflow-hidden">
          {historyQuery.isLoading ? (
            <Skeleton rows={6} cols={5}/>
          ) : (historyQuery.data?.validations || []).length === 0 ? (
            <EmptyState title="Aucune validation" message="Analysez un cahier pour créer le premier enregistrement."/>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Processing ID</th>
                    <th>Raison sociale</th>
                    <th>Fichier</th>
                    <th>Verdict</th>
                    <th>Taux</th>
                    <th>Marchand</th>
                    <th>Banque</th>
                    <th>Production</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(historyQuery.data?.validations || []).map(v => (
                    <tr key={v.id}>
                      <td className="font-mono text-xs text-brand">{v.processing_id}</td>
                      <td className="max-w-[140px] truncate font-medium" title={v.raison_sociale}>{v.raison_sociale || '—'}</td>
                      <td className="text-xs text-tertiary max-w-[120px] truncate" title={v.filename}>{v.filename}</td>
                      <td><VerdictBadge verdict={v.verdict}/></td>
                      <td className="font-mono text-xs">{v.taux_reussite != null ? `${v.taux_reussite}%` : '—'}</td>
                      <td>{v.marchand_notifie_at
                        ? <span className="badge badge-success text-xs">✓</span>
                        : <span className="text-tertiary text-xs">—</span>}</td>
                      <td>{v.banque_notifiee_at
                        ? <span className="badge badge-info text-xs" title={v.banque_notifiee_nom}>✓</span>
                        : <span className="text-tertiary text-xs">—</span>}</td>
                      <td>{v.prod_email_envoye_at
                        ? <span className="badge badge-success text-xs">✓</span>
                        : <span className="text-tertiary text-xs">—</span>}</td>
                      <td className="text-xs text-tertiary whitespace-nowrap">
                        {v.created_at ? new Date(v.created_at).toLocaleDateString('fr-FR') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modales */}
      {showNotify && result && (
        <NotifyMerchantModal result={result} validationId={validationId}
          onClose={() => setShowNotify(false)}
          onSent={() => qc.invalidateQueries({ queryKey: ['validations'] })}/>
      )}
      {showProd && result && (
        <ProdEmailModal result={result} validationId={validationId}
          onClose={() => setShowProd(false)}
          onSent={() => qc.invalidateQueries({ queryKey: ['validations'] })}/>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// AutoRunPanel — Exécution automatique des cas de test
// ══════════════════════════════════════════════════════════
const CASE_META = {
  'CTP-01': { name:'Enregistrement commande valide',       auto:true,  critical:true  },
  'CTP-02': { name:'Redirection page de paiement',         auto:false, critical:true  },
  'CTP-03': { name:'Vérification statut commande',         auto:true,  critical:true  },
  'CTP-04': { name:'Commande non payée (statut ≠ 2)',      auto:true,  critical:true  },
  'CTP-05': { name:'Statut returnUrl sans paiement',       auto:true,  critical:true  },
  'CTP-06': { name:'Paramètres manquants register.do',     auto:true,  critical:false },
  'CTP-07': { name:'Doublon orderNumber',                  auto:true,  critical:false },
  'CTP-08': { name:'orderId inexistant',                   auto:true,  critical:false },
};

function AutoRunPanel({ result, autoResults, autoRunning, onRun, onSwitchToAnalyse }) {
  const [expanded, setExpanded] = useState(null);

  const hasCredentials = result?.merchant?.apiUser && result?.merchant?.apiPwd;
  const cases = autoResults?.cases || [];
  const summary = autoResults?.summary || null;

  return (
    <div className="space-y-4">

      {/* Info box */}
      <div className="card p-4 border-l-2 border-brand bg-brand/5">
        <div className="text-sm font-semibold text-primary mb-1 flex items-center gap-2">
          <Zap size={14} className="text-brand"/> Exécution automatique des cas de test
        </div>
        <div className="text-xs text-secondary leading-relaxed">
          Appelle directement l'API ClicToPay TEST avec les credentials du cahier. Valide automatiquement
          7 cas sur 8 — CTP-02 nécessite une validation manuelle dans un navigateur.
        </div>
      </div>

      {/* Prérequis : cahier chargé */}
      {!result && (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <AlertCircle size={28} className="text-tertiary"/>
          <div className="text-sm text-secondary font-medium">Aucun cahier chargé</div>
          <div className="text-xs text-tertiary">
            Chargez d'abord un cahier de recettes dans l'onglet "Analyse manuelle" pour extraire les credentials.
          </div>
          <button onClick={onSwitchToAnalyse} className="btn-primary btn-sm mt-1">
            <FileText size={12}/> Aller à Analyse manuelle
          </button>
        </div>
      )}

      {/* Credentials trouvés */}
      {result && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
            Credentials extraits du cahier
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-tertiary mb-0.5">Marchand</div>
              <div className="text-sm font-medium text-primary truncate">{result.merchant?.raisonSociale || '—'}</div>
              <div className="text-xs text-tertiary font-mono">{result.merchant?.processingId || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-tertiary mb-0.5">Credentials API TEST</div>
              {hasCredentials ? (
                <>
                  <div className="text-xs font-mono text-brand">{result.merchant.apiUser}</div>
                  <div className="text-xs font-mono text-tertiary">{'•'.repeat(8)}</div>
                </>
              ) : (
                <div className="text-xs text-danger flex items-center gap-1">
                  <AlertCircle size={11}/> Introuvables dans le cahier
                </div>
              )}
            </div>
          </div>
          {!hasCredentials && (
            <div className="mt-3 text-xs text-warning bg-warning/10 rounded px-3 py-2">
              ⚠️ Les credentials API (Nom d'utilisateur + Mot de passe) doivent être renseignés dans la feuille "Informations" du cahier.
            </div>
          )}
        </div>
      )}

      {/* Tableau des cas + bouton lancer */}
      {result && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="text-xs font-semibold text-secondary uppercase tracking-wide">
              Cas de test ({Object.keys(CASE_META).length})
            </div>
            {summary && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-success font-medium">✅ {summary.pass} réussi</span>
                <span className="text-danger font-medium">❌ {summary.fail} échoué</span>
                <span className="text-tertiary">📋 1 manuel</span>
              </div>
            )}
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Cas de test</th>
                <th className="text-center">Mode</th>
                <th className="text-center">Verdict</th>
                <th className="text-center">Détail</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(CASE_META).map(([tcId, meta]) => {
                const r = cases.find(c => c.tcId === tcId);
                return (
                  <tr key={tcId} className={clsx(!meta.auto && 'opacity-60')}>
                    <td className="font-mono text-xs text-brand font-semibold">{tcId}</td>
                    <td>
                      <div className="text-xs font-medium">{meta.name}</div>
                      {meta.critical && (
                        <span className="text-xs text-danger font-medium">Critique</span>
                      )}
                    </td>
                    <td className="text-center">
                      {meta.auto ? (
                        <span className="badge badge-info text-xs">Auto</span>
                      ) : (
                        <span className="badge badge-neutral text-xs">Manuel</span>
                      )}
                    </td>
                    <td className="text-center">
                      {autoRunning && !r ? (
                        <Loader2 size={14} className="animate-spin text-tertiary mx-auto"/>
                      ) : r ? (
                        <span className={clsx('badge text-xs font-semibold',
                          r.verdict === 'RÉUSSI'  ? 'badge-success' :
                          r.verdict === 'ÉCHOUÉ'  ? 'badge-danger'  :
                          r.verdict === 'MANUEL'  ? 'badge-warning' :
                          'badge-neutral')}>
                          {r.verdict === 'RÉUSSI' ? '✅ RÉUSSI' :
                           r.verdict === 'ÉCHOUÉ' ? '❌ ÉCHOUÉ' :
                           r.verdict === 'MANUEL' ? '📋 MANUEL' :
                           r.verdict}
                        </span>
                      ) : (
                        <span className="text-xs text-tertiary">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {r && (r.issues?.length > 0 || r.note || r.response) && (
                        <button
                          onClick={() => setExpanded(expanded === tcId ? null : tcId)}
                          className="btn-ghost btn-sm text-xs">
                          {expanded === tcId ? '▲' : '▼'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Détail expandable */}
          {expanded && cases.find(c => c.tcId === expanded) && (() => {
            const r = cases.find(c => c.tcId === expanded);
            return (
              <div className="border-t border-border bg-surface2 px-4 py-3 space-y-2">
                {r.note && (
                  <div className="text-xs text-secondary bg-surface3 px-3 py-2 rounded font-mono">
                    {r.note}
                  </div>
                )}
                {r.issues?.length > 0 && (
                  <div className="space-y-1">
                    {r.issues.map((issue, i) => (
                      <div key={i} className="text-xs text-danger flex items-start gap-1.5">
                        <XCircle size={11} className="shrink-0 mt-0.5"/> {issue}
                      </div>
                    ))}
                  </div>
                )}
                {r.response && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-tertiary hover:text-secondary py-1">
                      Voir réponse API ClicToPay
                    </summary>
                    <pre className="mt-2 bg-surface3 rounded p-3 overflow-x-auto text-xs font-mono text-secondary max-h-48 overflow-y-auto">
                      {JSON.stringify(r.response, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Bouton lancer */}
      {result && (
        <button
          onClick={onRun}
          disabled={autoRunning || !hasCredentials}
          className="btn-primary w-full py-3 text-sm font-semibold flex items-center justify-center gap-2">
          {autoRunning ? (
            <><Loader2 size={16} className="animate-spin"/> Exécution en cours… (7 appels API)</>
          ) : (
            <><Zap size={16}/> Lancer l'exécution automatique (7 cas sur 8)</>
          )}
        </button>
      )}

      {summary && (
        <div className={clsx('card p-4 border-l-2 text-sm font-semibold',
          summary.fail === 0 ? 'border-success bg-success/5 text-success' : 'border-danger bg-danger/5 text-danger')}>
          {summary.fail === 0
            ? `✅ Tous les cas automatisables sont réussis (${summary.pass}/7) — CTP-02 à valider manuellement`
            : `❌ ${summary.fail} cas échoué(s) — corrigez l'intégration avant de valider le cahier`}
        </div>
      )}
    </div>
  );
}
