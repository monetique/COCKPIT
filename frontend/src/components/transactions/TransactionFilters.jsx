// src/components/transactions/TransactionFilters.jsx
import { Search, RotateCcw, Filter } from 'lucide-react';
import { DateInput, TextInput, Select } from '@/components/ui';
import clsx from 'clsx';

export default function TransactionFilters({
  filters, onUpdate, onApply, onReset, states = [], loading
}) {
  const handleKey = (e) => { if (e.key === 'Enter') onApply(); };

  const stateOptions = states.map(s => ({ value: s, label: s }));

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter size={13} className="text-tertiary" />
        <span className="text-xs font-semibold text-secondary uppercase tracking-wide">Filtres</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {/* Dates */}
        <DateInput
          label="Date début"
          value={filters.date_debut}
          onChange={v => onUpdate('date_debut', v)}
          className="col-span-2 md:col-span-1"
        />
        <DateInput
          label="Date fin"
          value={filters.date_fin}
          onChange={v => onUpdate('date_fin', v)}
          className="col-span-2 md:col-span-1"
        />

        {/* État */}
        <div className="col-span-2 md:col-span-1">
          <label className="block text-xs text-tertiary mb-1">État paiement</label>
          <Select
            value={filters.payment_state}
            onChange={v => onUpdate('payment_state', v)}
            options={stateOptions}
            placeholder="Tous les états"
          />
        </div>

        {/* Processing ID */}
        <TextInput
          label="Processing ID"
          value={filters.processing_id}
          onChange={v => onUpdate('processing_id', v)}
          placeholder="ex: 0520801267"
          onKeyDown={handleKey}
          className="col-span-2 md:col-span-1"
        />

        {/* Order Number */}
        <TextInput
          label="Order Number"
          value={filters.order_number}
          onChange={v => onUpdate('order_number', v)}
          placeholder="Numéro de commande"
          onKeyDown={handleKey}
          className="col-span-2 md:col-span-1"
        />

        {/* PAN */}
        <TextInput
          label="PAN (carte)"
          value={filters.pan}
          onChange={v => onUpdate('pan', v)}
          placeholder="6 premiers chiffres"
          onKeyDown={handleKey}
          className="col-span-2 md:col-span-1"
        />

        {/* Auth Code */}
        <TextInput
          label="Code auth"
          value={filters.auth_code}
          onChange={v => onUpdate('auth_code', v)}
          placeholder="Auth code"
          onKeyDown={handleKey}
          className="col-span-2 md:col-span-1"
        />

        {/* IP */}
        <TextInput
          label="Adresse IP"
          value={filters.ip}
          onChange={v => onUpdate('ip', v)}
          placeholder="ex: 192.168."
          onKeyDown={handleKey}
          className="col-span-2 md:col-span-1"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <button
          onClick={onApply}
          disabled={loading}
          className="btn-primary btn-sm"
        >
          <Search size={13} />
          Rechercher
        </button>
        <button
          onClick={onReset}
          className="btn-ghost btn-sm"
        >
          <RotateCcw size={13} />
          Réinitialiser
        </button>
        <span className="text-xs text-tertiary ml-auto">
          ↵ Entrée pour rechercher
        </span>
      </div>
    </div>
  );
}
