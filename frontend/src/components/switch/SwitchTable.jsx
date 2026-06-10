// src/components/switch/SwitchTable.jsx
import clsx          from 'clsx';
import { Pagination, EmptyState, Skeleton } from '@/components/ui';

const SUCCESS_STATES = ['OK','SUCCESS','PAID','APPROVED','ACCEPTED','VALIDE','DEPOSITED'];

function EtatBadge({ val }) {
  if (!val) return <span className="text-tertiary text-xs">—</span>;
  const up = val.toUpperCase();
  const ok = SUCCESS_STATES.some(s => up.includes(s));
  return (
    <span className={clsx('badge text-xs', ok ? 'badge-success' : 'badge-danger')}>
      {val}
    </span>
  );
}

function fmtDate(v) {
  if (!v) return '—';
  return String(v).trim();
}

function fmtAmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v) + ' TND';
}

export default function SwitchTable({ data, loading, page, pages, total, pageSize, onPage, onPageSize }) {
  if (loading && !data?.data?.length) return <Skeleton rows={8} cols={8}/>;

  const rows = data?.data || [];

  return (
    <div className={clsx('card overflow-hidden', loading && 'opacity-70 pointer-events-none')}>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Heure</th>
              <th>FSP</th>
              <th>Facturier</th>
              <th>Canal</th>
              <th>Solution</th>
              <th>Moyen</th>
              <th>Mode</th>
              <th>État</th>
              <th className="text-right">Montant</th>
              <th>Référence</th>
              <th>N° Réserv.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="text-center py-0">
                  <EmptyState title="Aucune transaction" message="Modifiez les filtres et relancez la recherche."/>
                </td>
              </tr>
            ) : rows.map((row, i) => (
              <tr key={i}>
                <td className="font-mono text-xs text-tertiary">{fmtDate(row['Date'])}</td>
                <td className="font-mono text-xs text-tertiary">{String(row['Heure'] || '—').slice(0,8)}</td>
                <td className="text-xs font-medium">{row['FSP'] || '—'}</td>
                <td className="text-xs max-w-[120px] truncate" title={row['Facturier']}>{row['Facturier'] || '—'}</td>
                <td className="text-xs text-secondary">{row['Canal'] || '—'}</td>
                <td className="text-xs text-secondary">{row['Solution'] || '—'}</td>
                <td className="text-xs text-secondary">{row['Moyen'] || '—'}</td>
                <td className="text-xs text-secondary">{row['Mode'] || '—'}</td>
                <td><EtatBadge val={row['Etat']}/></td>
                <td className="text-right font-mono text-xs font-medium">{fmtAmt(row['Montant'])}</td>
                <td className="font-mono text-xs text-tertiary max-w-[120px] truncate" title={row['Reference']}>{row['Reference'] || '—'}</td>
                <td className="font-mono text-xs text-tertiary">{row['Num_Reservation'] || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pages={pages} total={total} pageSize={pageSize} onPage={onPage} onPageSize={onPageSize}/>
    </div>
  );
}
