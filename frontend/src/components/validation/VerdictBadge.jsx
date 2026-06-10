// src/components/validation/VerdictBadge.jsx
import clsx from 'clsx';

const CFG = {
  approved: { cls: 'bg-success-dim border border-success/20 text-success', icon: '✅', label: 'APPROUVÉ' },
  refused : { cls: 'bg-danger-dim  border border-danger/20  text-danger',  icon: '❌', label: 'REFUSÉ'   },
  pending : { cls: 'bg-warning-dim border border-warning/20 text-warning', icon: '⚠️', label: 'INCOMPLET' },
  blank   : { cls: 'bg-surface3    border border-border     text-secondary',icon: '📋', label: 'VIERGE'   },
};

export function VerdictBadge({ verdict }) {
  const c = CFG[verdict] || CFG.pending;
  return (
    <span className={clsx('badge text-xs font-semibold', c.cls)}>
      {c.icon} {c.label}
    </span>
  );
}

export function VerdictBlock({ result }) {
  if (!result) return null;
  const c = CFG[result.verdict] || CFG.pending;

  const titles = {
    approved: 'APPROUVÉ — Passage en production autorisé',
    refused : 'REFUSÉ — Des corrections sont nécessaires',
    pending : 'INCOMPLET — Des tests restent à compléter',
    blank   : 'MODÈLE VIERGE — Aucune donnée marchand',
  };
  const subs = {
    approved: `Tous les cas critiques sont validés. ${result.pass}/${result.total} tests réussis.`,
    refused : `${result.criticalPass}/${result.criticalTotal} cas critiques · ${result.fail} cas échoués.`,
    pending : `${result.pass}/${result.total} tests complétés · ${result.pending} en attente.`,
    blank   : 'Transmettez ce fichier au marchand pour qu\'il le remplisse.',
  };

  return (
    <div className={clsx('rounded-xl p-5 flex items-start gap-4', c.cls)}>
      <div className="text-3xl shrink-0 mt-0.5">{c.icon}</div>
      <div>
        <div className="text-sm font-semibold">{titles[result.verdict]}</div>
        <div className="text-xs mt-1 opacity-80">{subs[result.verdict]}</div>
      </div>
    </div>
  );
}
