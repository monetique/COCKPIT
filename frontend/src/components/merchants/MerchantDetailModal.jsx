// src/components/merchants/MerchantDetailModal.jsx
import { X, Mail, Globe, Hash } from 'lucide-react';
import WorkflowTimeline from './WorkflowTimeline';

export default function MerchantDetailModal({ merchant, onClose }) {
  if (!merchant) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface border border-border2 rounded-xl w-full max-w-lg shadow-2xl animate-slide-up overflow-y-auto max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <div className="text-sm font-semibold text-primary">{merchant.raison_sociale || '—'}</div>
            <div className="text-xs font-mono text-brand mt-0.5">{merchant.processing_id}</div>
          </div>
          <button onClick={onClose} className="text-tertiary hover:text-primary mt-0.5">
            <X size={16}/>
          </button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Infos */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              ['Terminal',  merchant.numero_terminal],
              ['MCC',       merchant.mcc],
              ['Banque',    merchant.bank_name],
              ['Oracle',    [merchant.oracle_prod && 'PROD', merchant.oracle_test && 'TEST'].filter(Boolean).join(' + ') || 'Absent'],
              ['Email',     merchant.email_contact || merchant.webmaster],
              ['URL',       merchant.url],
            ].map(([label, value]) => value && (
              <div key={label} className="bg-surface2 rounded-lg px-3 py-2">
                <div className="text-tertiary mb-0.5">{label}</div>
                <div className="text-primary font-medium truncate" title={value}>{value}</div>
              </div>
            ))}
          </div>

          {/* Références */}
          {(merchant.tracking_ref_test || merchant.tracking_ref_prod) && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-secondary uppercase tracking-wide">Références</div>
              {merchant.tracking_ref_test && (
                <div className="flex items-center gap-2 text-xs">
                  <Hash size={11} className="text-tertiary"/>
                  <span className="text-tertiary">TEST :</span>
                  <span className="font-mono text-primary">{merchant.tracking_ref_test}</span>
                </div>
              )}
              {merchant.tracking_ref_prod && (
                <div className="flex items-center gap-2 text-xs">
                  <Hash size={11} className="text-tertiary"/>
                  <span className="text-tertiary">PROD :</span>
                  <span className="font-mono text-success">{merchant.tracking_ref_prod}</span>
                </div>
              )}
            </div>
          )}

          {/* Timeline */}
          <div>
            <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
              Progression workflow
            </div>
            <WorkflowTimeline merchant={merchant} />
          </div>

          {/* Notes */}
          {merchant.notes && (
            <div>
              <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Notes</div>
              <div className="text-xs text-secondary bg-surface2 rounded-lg p-3 whitespace-pre-wrap">
                {merchant.notes}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border flex justify-end">
          <button onClick={onClose} className="btn-ghost btn-sm">Fermer</button>
        </div>
      </div>
    </div>
  );
}
