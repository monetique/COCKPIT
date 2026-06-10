// src/components/merchants/MerchantsTable.jsx
import { useState } from 'react';
import { Send, ChevronDown, ChevronUp } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import clsx from 'clsx';

const STATUS_CFG = {
  prod  : { cls: 'badge-success', label: 'PROD' },
  test  : { cls: 'badge-info',    label: 'TEST' },
  both  : { cls: 'badge-warning', label: 'PROD+TEST' },
  absent: { cls: 'badge-danger',  label: 'Absent' },
};

export default function MerchantsTable({ rows, onTakeOver }) {
  const [sortKey, setSortKey] = useState('_status');
  const [sortDir, setSortDir] = useState('asc');

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = [...rows].sort((a, b) => {
    const av = String(a[sortKey] || '').toLowerCase();
    const bv = String(b[sortKey] || '').toLowerCase();
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  if (!rows.length) return (
    <EmptyState
      title="Aucun marchand trouvé"
      message="Importez un fichier Excel ou modifiez les filtres."
    />
  );

  const SortIcon = ({ k }) => sortKey === k
    ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
    : null;

  const Th = ({ k, children }) => (
    <th onClick={() => toggleSort(k)}
        className="cursor-pointer select-none hover:text-primary transition-colors">
      <span className="flex items-center gap-1">{children}<SortIcon k={k}/></span>
    </th>
  );

  return (
    <div className="card overflow-hidden">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th k="_normId">Affiliation</Th>
              <Th k="_raisonSociale">Raison sociale</Th>
              <Th k="_terminal">N° Terminal</Th>
              <th>Email / Webmaster</th>
              <th>URL</th>
              <Th k="_status">Statut Oracle</Th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const cfg  = STATUS_CFG[row._status] || STATUS_CFG.absent;
              const name = row._name  || row._rawId || '—';
              const acq  = row._bank  || '—';
              const email= row._email || '—';
              const site = row._site  || '—';

              return (
                <tr key={i} className={clsx(row._status === 'absent' && 'opacity-80')}>
                  <td className="font-mono text-xs text-brand">{row._normId || row._rawId || '—'}</td>
                  <td className="font-medium text-primary max-w-[180px] truncate" title={row._raisonSociale}>
                    {row._raisonSociale || '—'}
                  </td>
                  <td className="font-mono text-xs text-secondary">{row._terminal || '—'}</td>
                  <td className="text-xs text-tertiary font-mono max-w-[160px] truncate" title={row._email}>
                    {row._email || '—'}
                  </td>
                  <td className="text-xs text-tertiary max-w-[120px] truncate" title={row._url}>
                    {row._url ? (
                      <a href={row._url.startsWith('http') ? row._url : `https://${row._url}`}
                         target="_blank" rel="noreferrer"
                         className="text-info hover:underline">
                        {row._url.replace(/^https?:\/\//, '')}
                      </a>
                    ) : '—'}
                  </td>
                  <td><span className={clsx('badge', cfg.cls)}>{cfg.label}</span></td>
                  <td className="text-right">
                    <button
                      onClick={() => onTakeOver(row)}
                      className="btn-ghost btn-sm text-xs"
                      title="Prise en charge"
                    >
                      <Send size={11}/>
                      Prise en charge
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-border text-xs text-tertiary">
        {rows.length.toLocaleString('fr-FR')} marchand(s) affiché(s)
      </div>
    </div>
  );
}
