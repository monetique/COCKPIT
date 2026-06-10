// src/components/ui/index.jsx — Composants UI réutilisables
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Inbox } from 'lucide-react';

// ── Stat Card ─────────────────────────────────────────────
export function StatCard({ label, value, sub, accent = 'brand', icon: Icon }) {
  const accents = {
    brand  : 'bg-info-dim   text-info',
    success: 'bg-success-dim text-success',
    danger : 'bg-danger-dim  text-danger',
    warning: 'bg-warning-dim text-warning',
    neutral: 'bg-surface3   text-secondary',
  };
  return (
    <div className="card p-4 flex items-start gap-3">
      {Icon && (
        <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', accents[accent])}>
          <Icon size={16} />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xs text-tertiary truncate">{label}</div>
        <div className="text-xl font-semibold text-primary mt-0.5 font-mono">{value ?? '—'}</div>
        {sub && <div className="text-xs text-tertiary mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────
export function Badge({ children, variant = 'neutral' }) {
  const variants = {
    success: 'badge-success',
    danger : 'badge-danger',
    warning: 'badge-warning',
    info   : 'badge-info',
    neutral: 'badge-neutral',
  };
  return <span className={clsx('badge', variants[variant])}>{children}</span>;
}

// ── Empty State ───────────────────────────────────────────
export function EmptyState({ title = 'Aucune donnée', message }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <Inbox size={32} className="text-tertiary opacity-40" />
      <div>
        <div className="text-sm font-medium text-secondary">{title}</div>
        {message && <div className="text-xs text-tertiary mt-1">{message}</div>}
      </div>
    </div>
  );
}

// ── Loading Skeleton ──────────────────────────────────────
export function Skeleton({ rows = 5, cols = 6 }) {
  return (
    <div className="animate-pulse space-y-2 p-4">
      {Array(rows).fill(0).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array(cols).fill(0).map((_, j) => (
            <div key={j} className="h-4 bg-surface3 rounded flex-1"
              style={{ opacity: 1 - j * 0.1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────
export function Spinner({ size = 16 }) {
  return (
    <svg className="animate-spin text-brand" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-80" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  );
}

// ── Pagination ────────────────────────────────────────────
export function Pagination({ page, pages, total, pageSize, onPage, onPageSize }) {
  if (pages <= 0) return null;
  const pageSizes = [25, 50, 100, 200];
  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-secondary">
      {/* Infos */}
      <div className="flex items-center gap-3">
        <span>{from.toLocaleString()}–{to.toLocaleString()} sur {total.toLocaleString()}</span>
        <select
          value={pageSize}
          onChange={e => onPageSize(Number(e.target.value))}
          className="bg-surface2 border border-border2 rounded px-2 py-1 text-xs text-primary"
        >
          {pageSizes.map(s => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>

      {/* Boutons */}
      <div className="flex items-center gap-1">
        <PagBtn onClick={() => onPage(1)}        disabled={page === 1}><ChevronsLeft  size={13}/></PagBtn>
        <PagBtn onClick={() => onPage(page - 1)} disabled={page === 1}><ChevronLeft   size={13}/></PagBtn>
        <span className="px-3 py-1 text-primary font-medium">
          {page} / {pages}
        </span>
        <PagBtn onClick={() => onPage(page + 1)} disabled={page >= pages}><ChevronRight  size={13}/></PagBtn>
        <PagBtn onClick={() => onPage(pages)}    disabled={page >= pages}><ChevronsRight size={13}/></PagBtn>
      </div>
    </div>
  );
}

function PagBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 flex items-center justify-center rounded
                 hover:bg-surface3 disabled:opacity-30 disabled:cursor-not-allowed
                 text-secondary hover:text-primary transition-colors"
    >
      {children}
    </button>
  );
}

// ── Select input ──────────────────────────────────────────
export function Select({ value, onChange, options = [], placeholder = 'Tous', className = '' }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={clsx('input', className)}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  );
}

// ── Date input ────────────────────────────────────────────
export function DateInput({ value, onChange, placeholder, label, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs text-tertiary mb-1">{label}</label>}
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input text-xs"
      />
    </div>
  );
}

// ── Text input ────────────────────────────────────────────
export function TextInput({ value, onChange, placeholder, label, icon: Icon, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs text-tertiary mb-1">{label}</label>}
      <div className="relative">
        {Icon && <Icon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />}
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={clsx('input text-xs', Icon && 'pl-8')}
        />
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────
export function SectionHeader({ title, sub, children }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h1 className="text-lg font-semibold text-primary">{title}</h1>
        {sub && <p className="text-xs text-tertiary mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}
