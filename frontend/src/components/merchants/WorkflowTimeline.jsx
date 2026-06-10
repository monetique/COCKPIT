// src/components/merchants/WorkflowTimeline.jsx
import clsx from 'clsx';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';

const STEPS = [
  { key: 'en_attente',         label: 'En attente',         color: 'bg-tertiary',  dateField: 'date_import' },
  { key: 'prise_en_charge',    label: 'Prise en charge',    color: 'bg-info',      dateField: 'date_prise_en_charge' },
  { key: 'recettes_envoyees',  label: 'Recettes envoyées',  color: 'bg-warning',   dateField: 'date_envoi_recettes' },
  { key: 'recettes_recues',    label: 'Recettes reçues',    color: 'bg-warning',   dateField: 'date_reception_recettes' },
  { key: 'valide',             label: 'Validé',             color: 'bg-success',   dateField: 'date_validation' },
  { key: 'banque_notifiee',    label: 'Banque notifiée',    color: 'bg-brand',     dateField: 'date_notif_banque' },
  { key: 'en_production',      label: 'En production',      color: 'bg-success',   dateField: 'date_production' },
];

const ORDER = STEPS.map(s => s.key);

function fmtDate(v) {
  if (!v) return null;
  try {
    const d = new Date(v);
    return {
      full    : format(d, 'dd/MM/yyyy HH:mm', { locale: fr }),
      relative: formatDistanceToNow(d, { addSuffix: true, locale: fr }),
    };
  } catch { return null; }
}

function UATSection({ merchant }) {
  const s   = merchant.uat_status || 'non_provisionne';
  const mid = merchant.uat_merchant_id;
  const dt  = fmtDate(merchant.uat_provisioned_at);
  const login   = merchant.terminal_id || merchant.processing_id;
  const loginOP = login + '_OP';
  const pwd     = 'Ey0m4Q3AfY1p';

  const UAT_STATUS_CFG = {
    non_provisionne: { label: 'Non provisionné',  cls: 'badge-neutral',  dot: 'bg-tertiary' },
    api_ok         : { label: 'SQL en attente',   cls: 'badge-warning',  dot: 'bg-warning'  },
    provisionne    : { label: 'Provisionné ✓',    cls: 'badge-success',  dot: 'bg-success'  },
    api_erreur     : { label: 'Erreur API',        cls: 'badge-danger',   dot: 'bg-danger'   },
    sql_erreur     : { label: 'Erreur SQL',        cls: 'badge-danger',   dot: 'bg-danger'   },
    deja_existant  : { label: 'Déjà existant',     cls: 'badge-warning',  dot: 'bg-warning'  },
  };
  const cfg = UAT_STATUS_CFG[s] || UAT_STATUS_CFG.non_provisionne;

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`}/>
        <span className="text-xs font-semibold text-primary">ClicToPay UAT</span>
        <span className={`badge text-xs ${cfg.cls}`}>{cfg.label}</span>
      </div>

      {dt && (
        <div className="text-xs text-tertiary mb-2">
          <span className="font-mono">{dt.full}</span>
          <span className="ml-1.5 opacity-60">({dt.relative})</span>
        </div>
      )}

      {mid && (
        <div className="text-xs text-tertiary mb-3">
          Merchant ID : <span className="font-mono text-brand">{mid}</span>
        </div>
      )}

      {merchant.uat_error_message && s !== 'provisionne' && (
        <div className="text-xs text-danger bg-danger/10 rounded px-2 py-1 mb-3 leading-relaxed">
          {merchant.uat_error_message}
        </div>
      )}

      {s === 'provisionne' && (
        <div className="bg-surface2 rounded-lg overflow-hidden border border-border text-xs">
          <div className="px-3 py-1.5 bg-info/10 text-info font-semibold text-xs border-b border-border">
            🔗 API Paiement — TEST
          </div>
          <div className="px-3 py-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-tertiary">Nom d'utilisateur</span>
              <span className="font-mono text-primary">{login}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Mot de passe</span>
              <span className="font-mono text-danger">{pwd}</span>
            </div>
          </div>
          <div className="px-3 py-1.5 bg-success/10 text-success font-semibold text-xs border-t border-b border-border">
            📊 Portail Monitoring — TEST
          </div>
          <div className="px-3 py-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-tertiary">Nom d'utilisateur</span>
              <span className="font-mono text-primary">{loginOP}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Mot de passe</span>
              <span className="font-mono text-danger">{pwd}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkflowTimeline({ merchant, compact = false }) {
  if (!merchant) return null;

  const currentIdx = ORDER.indexOf(merchant.statut);

  if (compact) {
    const pct  = Math.round((currentIdx + 1) / ORDER.length * 100);
    const step = STEPS[currentIdx] || STEPS[0];
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 h-1.5 bg-surface3 rounded-full overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all duration-500', step.color)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={clsx('badge text-xs shrink-0', BADGE_MAP[merchant.statut] || 'badge-neutral')}>
          {step.label}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {STEPS.map((step, idx) => {
        const done    = idx <= currentIdx;
        const current = idx === currentIdx;
        const date    = fmtDate(merchant[step.dateField]);
        const isLast  = idx === STEPS.length - 1;

        return (
          <div key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={clsx(
                'w-3 h-3 rounded-full border-2 transition-all shrink-0 mt-1',
                done ? `${step.color} border-transparent` : 'bg-surface3 border-border2',
                current && 'ring-2 ring-offset-1 ring-offset-surface ring-current'
              )} />
              {!isLast && (
                <div className={clsx('w-0.5 flex-1 mt-1', done ? 'bg-border2' : 'bg-border')}
                  style={{ minHeight: '20px' }} />
              )}
            </div>
            <div className={clsx('pb-4 min-w-0', isLast && 'pb-0')}>
              <div className={clsx('text-xs font-medium leading-tight', done ? 'text-primary' : 'text-tertiary')}>
                {step.label}
                {current && (
                  <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-info-dim text-info">actuel</span>
                )}
              </div>
              {date && (
                <div className="text-xs text-tertiary mt-0.5">
                  <span className="font-mono">{date.full}</span>
                  <span className="ml-1.5 opacity-60">({date.relative})</span>
                </div>
              )}
              {!done && !date && (
                <div className="text-xs text-tertiary/50 mt-0.5">En attente…</div>
              )}
            </div>
          </div>
        );
      })}
      <UATSection merchant={merchant}/>
    </div>
  );
}

const BADGE_MAP = {
  en_attente       : 'badge-neutral',
  prise_en_charge  : 'badge-info',
  recettes_envoyees: 'badge-warning',
  recettes_recues  : 'badge-warning',
  valide           : 'badge-success',
  banque_notifiee  : 'badge-info',
  en_production    : 'badge-success',
};

export { BADGE_MAP };
