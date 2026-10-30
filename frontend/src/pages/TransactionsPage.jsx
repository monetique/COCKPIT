// src/pages/TransactionsPage.jsx
import { useState }            from 'react';
import { Download, RefreshCw, BarChart2, Table2 } from 'lucide-react';
import toast                   from 'react-hot-toast';
import * as XLSX               from 'xlsx';

import { SectionHeader, Spinner } from '@/components/ui';
import TransactionFilters      from '@/components/transactions/TransactionFilters';
import TransactionKPIs         from '@/components/transactions/TransactionKPIs';
import TransactionCharts       from '@/components/transactions/TransactionCharts';
import TransactionTable        from '@/components/transactions/TransactionTable';
import { useTransactions }     from '@/hooks/useTransactions';
import { exportTransactions }  from '@/api/transactions';

export default function TransactionsPage() {
  const {
    filters, updateFilter, applyFilters, resetFilters,
    page, setPage, pageSize, handlePageSize,
    query, statesQuery, statsQuery,
    data, stats, loading, error,
  } = useTransactions();

  const [showCharts,   setShowCharts]   = useState(true);
  const [exporting,    setExporting]    = useState(false);

  // ── Export Excel ────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    const toastId = toast.loading('Export en cours…');
    try {
      const apiFilters = {
        ...filters,
        date_debut: toFrDate(filters.date_debut),
        date_fin  : toFrDate(filters.date_fin),
      };
      const { data: res } = await exportTransactions(apiFilters);
      if (!res.success) throw new Error(res.error);

      const rows = res.data.map(r => ({
        'Date'              : formatDateExcel(r.TRANS_DATE),
        'Order Number'      : r.ORDERNUMBER,
        'Processing ID'     : r.PROCESSING_ID,
        'Marchand'          : r.MERCHANTFULLNAME,
        'MCC'               : r.MCC,
        'Terminal ID'       : r.TERMINAL_ID,
        'Carte (masquée)'   : r.CARTE_MASQUEE,
        'Montant (TND)'     : r.AMOUNT,
        'Montant approuvé'  : r.APPROVEDAMOUNT,
        'Montant déposé'    : r.DEPOSITEDAMOUNT,
        'Devise'            : r.CURRENCY,
        'État'              : r.PAYMENT_STATE,
        'Auth Code'         : r.AUTHORIZATION_RESPONSE_ID || r.AUTH_CODE,
        'Action Code'       : r.ACTION_CODE_INT,
        'Référence'         : r.REFERENCE_NUMBER,
        'STAN'              : r.STAN,
        'Réseau paiement'   : r.PAYMENT_SYSTEM,
        'Canal'             : r.DEVICE_CHANNEL,
        'Banque'            : r.BANK_NAME,
        'ECI'               : r.ECI,
        'Fraude'            : r.FRAUD_MARK,
        'IP'                : r.IP,
        'Date paiement'     : formatDateExcel(r.PAYMENT_DATE),
        'Date dépôt'        : formatDateExcel(r.DEPOSITED_DATE),
        'Texte'             : r.TEXT,
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      // Largeurs colonnes
      ws['!cols'] = [
        { wch:18 },{ wch:24 },{ wch:14 },{ wch:20 },
        { wch:14 },{ wch:12 },{ wch:12 },{ wch:12 },{ wch:16 },
        { wch:12 },{ wch:30 },
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

      const date = new Date().toISOString().slice(0,10);
      XLSX.writeFile(wb, `ClicToPay_Transactions_${date}.xlsx`);
      toast.success(`${rows.length.toLocaleString('fr-FR')} lignes exportées`, { id: toastId });
    } catch(e) {
      toast.error('Erreur export : ' + e.message, { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  // ── Rendu erreur ────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <div className="text-danger text-sm font-medium">Erreur Oracle BPC</div>
        <div className="text-xs text-tertiary font-mono max-w-md">{error.response?.data?.error || error.message}</div>
        <button onClick={() => query.refetch()} className="btn-ghost btn-sm">
          <RefreshCw size={13}/> Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0 animate-fade-in">

      {/* En-tête */}
      <SectionHeader
        title="Transactions CLICTOPAY"
        sub={data ? `${data.total?.toLocaleString('fr-FR')} transaction(s) — 7 derniers jours par défaut` : 'Chargement…'}
      >
        {/* Toggle graphiques */}
        <button
          onClick={() => setShowCharts(v => !v)}
          className={showCharts ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
          title="Afficher/masquer les graphiques"
        >
          {showCharts ? <BarChart2 size={13}/> : <Table2 size={13}/>}
          {showCharts ? 'Graphiques' : 'Tableau seul'}
        </button>

        {/* Refresh */}
        <button
          onClick={() => query.refetch()}
          disabled={loading}
          className="btn-ghost btn-sm"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* Export */}
        <button
          onClick={handleExport}
          disabled={exporting || !data?.total}
          className="btn-ghost btn-sm"
        >
          {exporting ? <Spinner size={13}/> : <Download size={13}/>}
          Export Excel
        </button>
      </SectionHeader>

      {/* Filtres */}
      <TransactionFilters
        filters={filters}
        onUpdate={updateFilter}
        onApply={applyFilters}
        onReset={resetFilters}
        states={statesQuery.data?.data || []}
        loading={loading}
      />

      {/* KPIs */}
      {data && <TransactionKPIs data={data} stats={stats} statsLoading={statsQuery.isFetching} />}

      {/* Graphiques — données de toute la journée (stats) et non de la sélection paginée */}
      {showCharts && <TransactionCharts data={stats} loading={statsQuery.isFetching} />}

      {/* Tableau */}
      <TransactionTable
        data={data}
        loading={loading}
        page={page}
        pages={data?.pages || 0}
        total={data?.total || 0}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={handlePageSize}
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────
function toFrDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatDateExcel(v) {
  if (!v) return '';
  try {
    return new Date(v).toLocaleString('fr-FR', {
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit'
    });
  } catch { return String(v); }
}
