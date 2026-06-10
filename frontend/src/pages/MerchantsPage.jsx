// src/pages/MerchantsPage.jsx
import { useState, useRef, useCallback }  from 'react';
import {
  Upload, X, RefreshCw, Store, TestTube, Database,
  AlertTriangle, Search, Filter, Download, ArrowUpFromLine
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx  from 'clsx';

import { SectionHeader, StatCard, Spinner } from '@/components/ui';
import DBMerchantsTable    from '@/components/merchants/DBMerchantsTable';
import MerchantsTable      from '@/components/merchants/MerchantsTable';
import WelcomeModal        from '@/components/merchants/WelcomeModal';
import MerchantDetailModal from '@/components/merchants/MerchantDetailModal';
import { useMerchants }    from '@/hooks/useMerchants';

export default function MerchantsPage() {
  const {
    prodQuery, testQuery, prodCount, testCount,
    trackingQuery, dbMerchants, dbTotal,
    dbSearch, setDbSearch, dbStatut, setDbStatut,
    excelRows, filteredExcel, excelStats,
    importExcel, clearExcel,
    filterName, setFilterName,
    filterStatus, setFilterStatus,
    importing, importToDB, exportFromDB,
    activeTab, setActiveTab,
    loading,
  } = useMerchants();

  const [dragging,      setDragging]      = useState(false);
  const [isImporting,   setIsImporting]   = useState(false);
  const [selectedRow,   setSelectedRow]   = useState(null);
  const [showWelcome,   setShowWelcome]   = useState(false);
  const [detailMerchant,setDetailMerchant]= useState(null);
  const fileRef = useRef();

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) { toast.error('Format invalide — .xlsx ou .xls requis'); return; }
    setIsImporting(true);
    try {
      const count = await importExcel(file);
      toast.success(`${count} lignes chargées depuis ${file.name}`);
    } catch(e) { toast.error('Erreur lecture Excel : ' + e.message); }
    finally    { setIsImporting(false); }
  }, [importExcel]);

  const onDrop  = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); };
  const onInput = (e) => handleFile(e.target.files[0]);

  const handleTakeOver = (row) => {
    const isDB = !!row.processing_id;
    const merchant = isDB
      ? { PROCESSING_ID: row.processing_id, MERCHANTFULLNAME: row.raison_sociale, TERMINAL_ID: row.numero_terminal, MCC: row.mcc }
      : (row._prodData || row._testData || { PROCESSING_ID: row._normId || row._rawId, MERCHANTFULLNAME: row._raisonSociale, TERMINAL_ID: row._terminal, MCC: row._mcc });
    if (!merchant.PROCESSING_ID) { toast.error("Numéro d'affiliation introuvable"); return; }
    const excelRow = isDB
      ? { _email: row.email_contact || row.webmaster, _url: row.url, _mcc: row.mcc, Webmaster: row.webmaster, Email: row.email_contact, URL: row.url, MCC: row.mcc }
      : { ...row, Webmaster: row['Webmaster'], Email: row['Email'], URL: row._url, MCC: row._mcc };
    setSelectedRow({ merchant, excelRow });
    setShowWelcome(true);
  };

  const DB_TABS = [
    'all','en_attente','prise_en_charge','recettes_envoyees',
    'recettes_recues','valide','banque_notifiee','en_production'
  ];
  const DB_LABELS = {
    all:'Tous', en_attente:'En attente', prise_en_charge:'Prise en charge',
    recettes_envoyees:'Recettes envoyées', recettes_recues:'Recettes reçues',
    valide:'Validé', banque_notifiee:'Banque notifiée', en_production:'En production'
  };
  const EXCEL_TABS = [
    { key:'all', label:'Tous', count: excelStats.total  },
    { key:'absent', label:'Absents', count: excelStats.absent },
    { key:'test', label:'En test', count: excelStats.test },
    { key:'prod', label:'En prod', count: excelStats.prod },
  ];

  const enAttente = dbMerchants.filter(m => m.statut === 'en_attente').length;

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader title="CTP Merchants" sub="Suivi affiliation · Import Excel · Workflow production">
        <button onClick={() => { prodQuery.refetch(); testQuery.refetch(); trackingQuery.refetch(); }} disabled={loading} className="btn-ghost btn-sm">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Actualiser
        </button>
        <button onClick={exportFromDB} className="btn-ghost btn-sm">
          <Download size={13}/> Exporter
        </button>
      </SectionHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Store}        label="Marchands PROD"  value={prodQuery.isFetching ? '…' : prodCount.toLocaleString()} sub="Oracle Production"  accent="success"/>
        <StatCard icon={TestTube}     label="Marchands TEST"  value={testQuery.isFetching ? '…' : testCount.toLocaleString()} sub="Oracle Test"         accent="info"/>
        <StatCard icon={Database}     label="En base (total)" value={trackingQuery.isFetching ? '…' : dbTotal.toLocaleString()} sub="PostgreSQL"         accent="brand"/>
        <StatCard icon={AlertTriangle} label="En attente"     value={trackingQuery.isFetching ? '…' : enAttente.toLocaleString()} sub="À prendre en charge" accent="warning"/>
      </div>

      {/* Onglets */}
      <div className="flex border-b border-border">
        {[
          { key:'db',    icon:Database,         label:`Base de données (${dbTotal})` },
          { key:'excel', icon:ArrowUpFromLine,   label:`Import Excel${excelRows.length ? ` (${excelRows.length})` : ''}` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={clsx('flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key ? 'border-brand text-primary' : 'border-transparent text-tertiary hover:text-secondary')}>
            <tab.icon size={14}/>{tab.label}
          </button>
        ))}
      </div>

      {/* ── Onglet DB ─────────────────────────────── */}
      {activeTab === 'db' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary"/>
              <input type="text" value={dbSearch} onChange={e => setDbSearch(e.target.value)}
                placeholder="Nom / Affiliation…" className="input pl-7 py-1.5 text-xs w-52"/>
            </div>
            <div className="flex bg-surface2 rounded-lg p-0.5 gap-0.5 flex-wrap">
              {DB_TABS.map(k => (
                <button key={k} onClick={() => setDbStatut(k)}
                  className={clsx('px-2.5 py-1.5 rounded text-xs font-medium transition-all whitespace-nowrap',
                    dbStatut === k ? 'bg-surface border border-border2 text-primary' : 'text-tertiary hover:text-secondary')}>
                  {DB_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          <DBMerchantsTable merchants={dbMerchants} loading={trackingQuery.isFetching}
            onTakeOver={handleTakeOver} onDetail={setDetailMerchant}
            onRefresh={() => trackingQuery.refetch()}/>
        </>
      )}

      {/* ── Onglet Excel ──────────────────────────── */}
      {activeTab === 'excel' && (
        <>
          {excelRows.length === 0 ? (
            <div onDragOver={(e)=>{ e.preventDefault(); setDragging(true); }}
                 onDragLeave={()=>setDragging(false)} onDrop={onDrop}
                 onClick={()=>fileRef.current?.click()}
                 className={clsx('card p-10 flex flex-col items-center gap-3 cursor-pointer border-2 border-dashed transition-all',
                   dragging ? 'border-brand bg-brand/5' : 'border-border hover:border-border2 hover:bg-surface2')}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onInput}/>
              {isImporting ? <Spinner size={28}/> : (
                <>
                  <div className={clsx('w-14 h-14 rounded-2xl flex items-center justify-center', dragging ? 'bg-brand/20' : 'bg-surface3')}>
                    <Upload size={22} className={dragging ? 'text-brand' : 'text-tertiary'}/>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium text-primary">{dragging ? 'Déposer le fichier' : "Importer le fichier d'affiliation"}</div>
                    <div className="text-xs text-tertiary mt-1">Glissez-déposez ou cliquez · .xlsx / .xls</div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="card p-3 flex flex-wrap items-center gap-2">
                <Filter size={13} className="text-tertiary shrink-0"/>
                <div className="flex bg-surface2 rounded-lg p-0.5 gap-0.5">
                  {EXCEL_TABS.map(tab => (
                    <button key={tab.key} onClick={() => setFilterStatus(tab.key)}
                      className={clsx('px-2.5 py-1.5 rounded text-xs font-medium transition-all',
                        filterStatus === tab.key ? 'bg-surface border border-border2 text-primary' : 'text-tertiary hover:text-secondary')}>
                      {tab.label} <span className="ml-1 text-tertiary">{tab.count}</span>
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary"/>
                  <input type="text" value={filterName} onChange={e => setFilterName(e.target.value)}
                    placeholder="Nom / ID…" className="input pl-7 py-1.5 text-xs w-40"/>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-tertiary">{filteredExcel.length} / {excelRows.length}</span>
                  <button onClick={importToDB} disabled={importing} className="btn-primary btn-sm">
                    {importing ? <Spinner size={13}/> : <Database size={13}/>}
                    Enregistrer en base
                  </button>
                  <button onClick={clearExcel} className="btn-ghost btn-sm"><X size={12}/> Effacer</button>
                </div>
              </div>

              {excelStats.total > 0 && excelStats.absent === excelStats.total && (() => {
                const cols = excelRows[0] ? Object.keys(excelRows[0]) : [];
                return cols.length > 0 && (
                  <div className="card p-4 bg-warning-dim border-warning/30">
                    <div className="text-xs font-semibold text-warning mb-2">⚠️ Aucun Processing ID reconnu — colonnes détectées :</div>
                    <div className="flex flex-wrap gap-1.5">
                      {cols.map(col => <span key={col} className="font-mono text-xs bg-surface3 text-secondary px-2 py-0.5 rounded">{col}</span>)}
                    </div>
                    <div className="text-xs text-tertiary mt-2">La colonne doit s'appeler <code className="bg-surface3 px-1 rounded">Affiliation</code>.</div>
                  </div>
                );
              })()}

              <MerchantsTable rows={filteredExcel} onTakeOver={handleTakeOver}/>
            </>
          )}
        </>
      )}

      {showWelcome && selectedRow && (
        <WelcomeModal merchant={selectedRow.merchant} excelRow={selectedRow.excelRow}
          onClose={() => { setShowWelcome(false); setSelectedRow(null); }}
          onSent={({ trackingRef }) => {
            trackingQuery.refetch();
            toast.success(`✅ Recettes envoyées — Réf. ${trackingRef}`, { duration: 5000 });
          }}/>
      )}
      {detailMerchant && (
        <MerchantDetailModal merchant={detailMerchant} onClose={() => setDetailMerchant(null)}/>
      )}
    </div>
  );
}
