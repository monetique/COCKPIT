// src/components/transactions/TransactionTable.jsx
import clsx    from 'clsx';
import { Pagination, EmptyState, Skeleton } from '@/components/ui';

const STATE_VARIANT = {
  payment_deposited : { cls: 'badge-success', label: 'Déposé'    },
  payment_declined  : { cls: 'badge-danger',  label: 'Refusé'    },
  payment_approved  : { cls: 'badge-success', label: 'Approuvé'  },
  payment_void      : { cls: 'badge-warning', label: 'Annulé'    },
  started           : { cls: 'badge-info',    label: 'Démarré'   },
  default           : { cls: 'badge-neutral', label: null         },
};

function StateBadge({ state }) {
  const key = String(state || '').toLowerCase().trim();
  const s   = STATE_VARIANT[key] || STATE_VARIANT.default;
  return <span className={clsx('badge', s.cls)}>{s.label || state || '—'}</span>;
}

function fmtDate(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' })
         + ' ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  } catch { return String(v); }
}

function fmtAmount(v) {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v) + ' TND';
}

export default function TransactionTable({
  data, loading, page, pages, total, pageSize, onPage, onPageSize
}) {
  if (loading && !data?.data?.length) return <Skeleton rows={8} cols={9}/>;

  const rows = data?.data || [];

  return (
    <div className={clsx('card overflow-hidden', loading && 'opacity-70 pointer-events-none')}>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Order N°</th>
              <th>Processing ID</th>
              <th>Marchand</th>
              <th>Terminal</th>
              <th>Carte</th>
              <th className="text-right">Montant</th>
              <th>État</th>
              <th>Auth Code</th>
              <th>Réseau</th>
              <th>Canal</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="text-center py-0">
                  <EmptyState title="Aucune transaction trouvée" message="Modifiez les filtres ou élargissez la plage de dates."/>
                </td>
              </tr>
            ) : rows.map((row, i) => (
              <tr key={i}>
                <td className="text-xs font-mono text-tertiary whitespace-nowrap">
                  {fmtDate(row.TRANS_DATE)}
                </td>
                <td className="font-mono text-xs max-w-[110px] truncate" title={row.ORDERNUMBER}>
                  {row.ORDERNUMBER || '—'}
                </td>
                <td className="font-mono text-xs text-brand">
                  {row.PROCESSING_ID || '—'}
                </td>
                <td className="text-xs font-medium max-w-[150px] truncate" title={row.MERCHANTFULLNAME}>
                  {row.MERCHANTFULLNAME || '—'}
                </td>
                <td className="font-mono text-xs text-secondary">
                  {row.TERMINAL_ID || '—'}
                </td>
                <td className="font-mono text-xs tracking-wider">
                  {row.CARTE_MASQUEE || '—'}
                </td>
                <td className="text-right font-mono text-xs font-medium text-primary">
                  {fmtAmount(row.AMOUNT)}
                </td>
                <td><StateBadge state={row.PAYMENT_STATE}/></td>
                {/* AUTH CODE = AUTHORIZATION_RESPONSE_ID */}
                <td className="font-mono text-xs text-success">
                  {row.AUTHORIZATION_RESPONSE_ID || row.AUTH_CODE || '—'}
                </td>
                <td className="text-xs text-secondary">
                  {row.PAYMENT_SYSTEM || '—'}
                </td>
                <td className="text-xs text-secondary">
                  {row.DEVICE_CHANNEL || '—'}
                </td>
                <td className="text-xs text-tertiary font-mono">
                  {row.IP || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pages={pages} total={total} pageSize={pageSize} onPage={onPage} onPageSize={onPageSize}/>
    </div>
  );
}
