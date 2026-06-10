// src/pages/PaysmartPage.jsx
import { useState }         from 'react';
import { Download, RefreshCw, Globe2, Table2, BarChart2 } from 'lucide-react';
import clsx                 from 'clsx';

import { SectionHeader, Spinner } from '@/components/ui';
import SwitchFilters        from '@/components/switch/SwitchFilters';
import SwitchKPIs           from '@/components/switch/SwitchKPIs';
import SwitchCharts         from '@/components/switch/SwitchCharts';
import SwitchTable          from '@/components/switch/SwitchTable';
import { useSwitch }        from '@/hooks/useSwitch';

export default function PaysmartPage() {
  const {
    filters, updateFilter, search, reset,
    page, setPage, pageSize, handlePageSize,
    applied, txQuery, dropdownsQuery,
    data, loading, allData, kpis,
    loadingAll, exporting, exportToExcel,
  } = useSwitch();

  const [activeTab, setActiveTab] = useState('tableau');

  const ddOk           = dropdownsQuery.isSuccess;
  const ddErr          = dropdownsQuery.isError;
  const hasData        = allData.length > 0;
  const analyticsReady = txQuery.data?.total > 0; // accessible dès qu'il y a des résultats

  return (
    <div className="space-y-4 animate-fade-in">

      {/* En-tête */}
      <SectionHeader
        title="PAYSMART · SwitchBI"
        sub={data
          ? `${data.total?.toLocaleString('fr-FR')} transaction(s) — SQL Server`
          : 'Switch de paiement · Transactions SwitchBI'}
      >
        {/* Statut SQL Server */}
        <div className={clsx('flex items-center gap-1.5 text-xs',
          ddOk ? 'text-success' : ddErr ? 'text-danger' : 'text-warning')}
          title={ddErr ? (dropdownsQuery.error?.response?.data?.hint || dropdownsQuery.error?.response?.data?.error || 'Erreur SQL Server') : ''}>
          <Globe2 size={12}/>
          <span className={clsx('w-1.5 h-1.5 rounded-full',
            ddOk ? 'bg-success animate-pulse' : ddErr ? 'bg-danger' : 'bg-warning animate-pulse')}/>
          {ddOk
            ? 'SQL Server connecté'
            : ddErr
              ? (dropdownsQuery.error?.response?.data?.hint || 'SQL Server — erreur de connexion')
              : 'Connexion…'}
        </div>

        {/* Refresh */}
        <button onClick={() => txQuery.refetch()} disabled={loading}
          className="btn-ghost btn-sm">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/>
        </button>

        {/* Export */}
        <button onClick={exportToExcel} disabled={exporting || !hasData}
          className="btn-ghost btn-sm">
          {exporting ? <Spinner size={13}/> : <Download size={13}/>}
          Export Excel
        </button>
      </SectionHeader>

      {/* Filtres */}
      <SwitchFilters
        filters={filters}
        onUpdate={updateFilter}
        onSearch={search}
        onReset={reset}
        dropdowns={dropdownsQuery.data || {}}
        loading={loading}
      />

      {/* Erreur */}
      {txQuery.isError && (
        <div className="card p-6 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-danger-dim flex items-center justify-center shrink-0">
              <Globe2 size={16} className="text-danger"/>
            </div>
            <div>
              <div className="text-danger font-semibold text-sm">Erreur SQL Server</div>
              <div className="text-xs text-secondary mt-1">
                {txQuery.error?.response?.status === 503
                  ? 'SQL Server non connecté — vérifiez les variables MSSQL_* dans votre .env'
                  : txQuery.error?.response?.data?.hint
                    || txQuery.error?.response?.data?.error
                    || txQuery.error?.message}
              </div>
              {txQuery.error?.response?.data?.error && txQuery.error?.response?.data?.hint && (
                <div className="text-xs font-mono text-tertiary mt-1 bg-surface2 rounded px-2 py-1">
                  {txQuery.error.response.data.error}
                </div>
              )}
            </div>
          </div>

          {/* Guide de diagnostic */}
          <div className="bg-surface2 rounded-lg p-3 text-xs text-secondary space-y-1.5">
            <div className="font-semibold text-tertiary uppercase tracking-wide text-xs mb-2">
              Vérifications
            </div>
            <div>1. Regardez le terminal du serveur — cherchez <code className="bg-surface3 px-1 rounded">❌ SQL Server:</code></div>
            <div>2. Vérifiez <code className="bg-surface3 px-1 rounded">C:\SMT_COCKPIT\.env</code> :</div>
            <pre className="bg-surface3 rounded p-2 text-xs text-tertiary mt-1 overflow-x-auto">{`MSSQL_USER=sa
MSSQL_PASSWORD=VotreMotDePasse
MSSQL_HOST=192.168.x.x
MSSQL_PORT=1433
MSSQL_DATABASE=switchdb`}</pre>
            <div>3. Après correction du .env, redémarrez : <code className="bg-surface3 px-1 rounded">node server-v2.js</code></div>
          </div>

          <button onClick={search} className="btn-ghost btn-sm">
            <RefreshCw size={13}/> Réessayer
          </button>
        </div>
      )}

      {/* Résultats */}
      {!txQuery.isError && (
        <>
          {/* Onglets Tableau / Analytics */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('tableau')}
              className={clsx(
                'flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'tableau'
                  ? 'border-brand text-primary'
                  : 'border-transparent text-tertiary hover:text-secondary'
              )}>
              <Table2 size={14}/>
              Tableau
              {data?.total > 0 && (
                <span className="badge badge-neutral text-xs ml-1">
                  {data.total.toLocaleString('fr-FR')}
                </span>
              )}
            </button>

            <button
              onClick={() => analyticsReady && setActiveTab('analytics')}
              className={clsx(
                'flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'analytics'
                  ? 'border-brand text-primary'
                  : 'border-transparent text-tertiary hover:text-secondary',
                !analyticsReady && 'opacity-40 cursor-not-allowed'
              )}>
              <BarChart2 size={14}/>
              Analytics
              {loadingAll && <Spinner size={11}/>}
              {hasData && !loadingAll && (
                <span className="badge badge-info text-xs ml-1">
                  {allData.length.toLocaleString('fr-FR')}
                </span>
              )}
            </button>
          </div>

          {/* ── Onglet Tableau ──────────────────────── */}
          {activeTab === 'tableau' && (
            <SwitchTable
              data={data}
              loading={loading}
              page={page}
              pages={data?.pages || 0}
              total={data?.total || 0}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={handlePageSize}
            />
          )}

          {/* ── Onglet Analytics ────────────────────── */}
          {activeTab === 'analytics' && (
            <>
              {loadingAll && !hasData ? (
                <div className="card p-10 flex flex-col items-center gap-3">
                  <Spinner size={24}/>
                  <div className="text-xs text-tertiary">Chargement des données analytiques…</div>
                </div>
              ) : hasData ? (
                <>
                  <SwitchKPIs kpis={kpis}/>
                  <SwitchCharts allData={allData}/>
                </>
              ) : (
                <div className="card p-10 flex flex-col items-center gap-3">
                  <Spinner size={24}/>
                  <div className="text-xs text-tertiary">Préparation des graphiques…</div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
