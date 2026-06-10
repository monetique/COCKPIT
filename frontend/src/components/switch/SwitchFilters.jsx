// src/components/switch/SwitchFilters.jsx
import { Search, RotateCcw, Filter, Database } from 'lucide-react';
import { Select, DateInput, TextInput } from '@/components/ui';
import clsx from 'clsx';

const MODE_OPTS = [
  { value: 'new',  label: 'TO_QLIK_BI_new (récent)' },
  { value: 'hist', label: 'TO_QLIK_BI (historique)'  },
];

export default function SwitchFilters({ filters, onUpdate, onSearch, onReset, dropdowns = {}, loading }) {
  const handleKey = (e) => { if (e.key === 'Enter') onSearch(); };

  const fspOpts      = (dropdowns.fsp      || []).map(v => ({ value: v, label: v }));
  const etatOpts     = (dropdowns.etat     || []).map(v => ({ value: v, label: v }));
  const facturierOpts= (dropdowns.facturier|| []).map(v => ({ value: v, label: v }));

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter size={13} className="text-tertiary"/>
        <span className="text-xs font-semibold text-secondary uppercase tracking-wide">Filtres</span>
        {/* Mode table */}
        <div className="ml-auto flex bg-surface2 rounded-lg p-0.5 gap-0.5">
          {MODE_OPTS.map(opt => (
            <button key={opt.value}
              onClick={() => onUpdate('table_mode', opt.value)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all',
                filters.table_mode === opt.value
                  ? 'bg-surface border border-border2 text-primary'
                  : 'text-tertiary hover:text-secondary'
              )}>
              <Database size={11}/>{opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <DateInput label="Date début"   value={filters.date_debut} onChange={v => onUpdate('date_debut', v)} className="col-span-2 md:col-span-1"/>
        <DateInput label="Date fin"     value={filters.date_fin}   onChange={v => onUpdate('date_fin', v)}   className="col-span-2 md:col-span-1"/>

        <div className="col-span-1">
          <label className="block text-xs text-tertiary mb-1">Heure début</label>
          <input type="time" value={filters.heure_debut} onChange={e => onUpdate('heure_debut', e.target.value)} className="input text-xs"/>
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-tertiary mb-1">Heure fin</label>
          <input type="time" value={filters.heure_fin} onChange={e => onUpdate('heure_fin', e.target.value)} className="input text-xs"/>
        </div>

        <div className="col-span-2 md:col-span-1">
          <label className="block text-xs text-tertiary mb-1">FSP</label>
          <Select value={filters.fsp} onChange={v => onUpdate('fsp', v)} options={fspOpts} placeholder="ALL"/>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="block text-xs text-tertiary mb-1">État</label>
          <Select value={filters.etat} onChange={v => onUpdate('etat', v)} options={etatOpts} placeholder="ALL"/>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="block text-xs text-tertiary mb-1">Facturier</label>
          <Select value={filters.facturier} onChange={v => onUpdate('facturier', v)} options={facturierOpts} placeholder="ALL"/>
        </div>

        <TextInput label="Canal"       value={filters.canal}       onChange={v => onUpdate('canal', v)}       placeholder="Canal"    onKeyDown={handleKey} className="col-span-2 md:col-span-1"/>
        <TextInput label="Solution"    value={filters.solution}    onChange={v => onUpdate('solution', v)}    placeholder="Solution" onKeyDown={handleKey} className="col-span-2 md:col-span-1"/>
        <TextInput label="Moyen"       value={filters.moyen}       onChange={v => onUpdate('moyen', v)}       placeholder="Moyen"    onKeyDown={handleKey} className="col-span-2 md:col-span-1"/>
        <TextInput label="Mode"        value={filters.mode}        onChange={v => onUpdate('mode', v)}        placeholder="Mode"     onKeyDown={handleKey} className="col-span-2 md:col-span-1"/>
        <TextInput label="Réf. Auto"   value={filters.ref_auto}    onChange={v => onUpdate('ref_auto', v)}    placeholder="Ref auto" onKeyDown={handleKey} className="col-span-2 md:col-span-1"/>
        <TextInput label="Référence"   value={filters.reference}   onChange={v => onUpdate('reference', v)}   placeholder="Référence" onKeyDown={handleKey} className="col-span-2 md:col-span-1"/>
        <TextInput label="N° Réserv."  value={filters.num_reservation} onChange={v => onUpdate('num_reservation', v)} placeholder="N° réservation" onKeyDown={handleKey} className="col-span-2 md:col-span-1"/>

        <div className="col-span-1">
          <label className="block text-xs text-tertiary mb-1">Montant min</label>
          <input type="number" value={filters.montant_min} onChange={e => onUpdate('montant_min', e.target.value)} placeholder="0" className="input text-xs" onKeyDown={handleKey}/>
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-tertiary mb-1">Montant max</label>
          <input type="number" value={filters.montant_max} onChange={e => onUpdate('montant_max', e.target.value)} placeholder="9999" className="input text-xs" onKeyDown={handleKey}/>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <button onClick={onSearch} disabled={loading} className="btn-primary btn-sm">
          <Search size={13}/> Rechercher
        </button>
        <button onClick={onReset} className="btn-ghost btn-sm">
          <RotateCcw size={13}/> Réinitialiser
        </button>
        <span className="text-xs text-tertiary ml-auto">↵ Entrée pour rechercher</span>
      </div>
    </div>
  );
}
