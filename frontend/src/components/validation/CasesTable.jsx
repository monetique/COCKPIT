// src/components/validation/CasesTable.jsx
import { useState } from 'react';
import { ChevronDown, ChevronRight, PlayCircle, CheckCircle2, XCircle, Loader } from 'lucide-react';
import clsx from 'clsx';
import { PRIORITY } from '@/utils/validationEngine';
import { verifyCtp01 } from '@/api/validation';
import toast from 'react-hot-toast';

const RESULT_CFG = {
  pass   : { cls: 'badge-success', label: 'Réussi'     },
  fail   : { cls: 'badge-danger',  label: 'Échoué'     },
  pending: { cls: 'badge-warning', label: 'En attente' },
};

const PRIORITY_CFG = {
  Critique: 'badge-danger',
  Haute   : 'badge-warning',
  Normale : 'badge-neutral',
};

export default function CasesTable({ cases = [], merchant = {} }) {
  const [expanded,   setExpanded]   = useState(new Set());
  const [ctp01State, setCtp01State] = useState(null); // null | 'loading' | {verdict, issues, ctpResponse}

  const toggle = (id) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  // ── Vérification CTP-01 ─────────────────────────────────
  const handleVerifyCtp01 = async () => {
    const ctp01Case = cases.find(c => c.tcId === 'CTP-01');
    if (!ctp01Case?.orderId) {
      toast.error('orderId introuvable dans la réponse JSON de CTP-01 — vérifiez que le JSON est bien renseigné dans le cahier');
      return;
    }
    if (!merchant.apiUser || !merchant.apiPwd) {
      toast.error('Credentials API TEST introuvables dans la feuille Informations du cahier');
      return;
    }

    setCtp01State('loading');
    try {
      const { data } = await verifyCtp01({
        orderId  : ctp01Case.orderId,
        userName : merchant.apiUser,
        password : merchant.apiPwd,
      });
      setCtp01State(data);
      if (data.verdict === 'RÉUSSI') {
        toast.success(`✅ CTP-01 vérifié — orderId ${ctp01Case.orderId} confirmé`);
      } else {
        toast.error(`❌ CTP-01 — ${data.issues?.join(' | ')}`);
      }
    } catch(e) {
      const msg = e.response?.data?.error || e.message;
      setCtp01State({ verdict:'ERREUR', issues:[msg] });
      toast.error('Erreur vérification CTP-01 : ' + msg);
    }
  };

  if (!cases.length) return (
    <div className="text-center text-tertiary text-xs py-8">Aucun cas de test trouvé</div>
  );

  const ctp01Case = cases.find(c => c.tcId === 'CTP-01');

  return (
    <div className="space-y-3">

      {/* ── Bouton vérification CTP-01 ── */}
      {ctp01Case && (
        <div className="card p-4 border border-info/20 bg-info-dim/30 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold text-primary flex items-center gap-2">
                <PlayCircle size={15} className="text-info"/>
                Vérification automatique — CTP-01
              </div>
              <div className="text-xs text-tertiary mt-0.5">
                Appel <span className="font-mono">getOrderStatusExtended.do</span> avec les credentials du cahier
              </div>
            </div>
            <button
              onClick={handleVerifyCtp01}
              disabled={ctp01State === 'loading'}
              className="btn-primary btn-sm flex items-center gap-1.5"
            >
              {ctp01State === 'loading'
                ? <><Loader size={13} className="animate-spin"/> Vérification…</>
                : <><PlayCircle size={13}/> Vérifier CTP-01</>}
            </button>
          </div>

          {/* Paramètres utilisés */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-surface rounded p-2">
              <div className="text-tertiary mb-0.5">Utilisateur API</div>
              <div className="font-mono font-medium text-primary truncate">
                {merchant.apiUser || <span className="text-danger">Non trouvé</span>}
              </div>
            </div>
            <div className="bg-surface rounded p-2">
              <div className="text-tertiary mb-0.5">Mot de passe API</div>
              <div className="font-mono font-medium text-primary">
                {merchant.apiPwd ? '••••••••' : <span className="text-danger">Non trouvé</span>}
              </div>
            </div>
            <div className="bg-surface rounded p-2">
              <div className="text-tertiary mb-0.5">orderId extrait</div>
              <div className="font-mono font-medium text-brand truncate">
                {ctp01Case.orderId || <span className="text-warning">JSON non renseigné</span>}
              </div>
            </div>
          </div>

          {/* Résultat de la vérification */}
          {ctp01State && ctp01State !== 'loading' && (
            <div className={clsx(
              'rounded-lg p-3 border text-xs space-y-2',
              ctp01State.verdict === 'RÉUSSI'
                ? 'bg-success-dim border-success/30'
                : 'bg-danger-dim border-danger/30'
            )}>
              {/* Verdict */}
              <div className="flex items-center gap-2 font-semibold">
                {ctp01State.verdict === 'RÉUSSI'
                  ? <><CheckCircle2 size={14} className="text-success"/><span className="text-success">CTP-01 RÉUSSI — orderId confirmé via getOrderStatusExtended.do</span></>
                  : <><XCircle      size={14} className="text-danger"/> <span className="text-danger">CTP-01 {ctp01State.verdict}</span></>}
              </div>

              {/* Comparaison orderId ↔ mdOrder */}
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="bg-surface rounded p-2">
                  <div className="text-tertiary mb-0.5">orderId (cahier CTP-01)</div>
                  <div className="font-mono text-primary break-all">{ctp01State.orderId || '—'}</div>
                </div>
                <div className="bg-surface rounded p-2">
                  <div className="text-tertiary mb-0.5">mdOrder (attributes API)</div>
                  <div className="font-mono text-primary break-all">{ctp01State.mdOrder || '—'}</div>
                </div>
              </div>

              {/* Résultat comparaison */}
              <div className={clsx(
                'flex items-center gap-2 rounded px-3 py-1.5 font-medium',
                ctp01State.match
                  ? 'bg-success/10 text-success'
                  : 'bg-danger/10 text-danger'
              )}>
                {ctp01State.match
                  ? <><CheckCircle2 size={12}/> orderId = mdOrder ✓ Correspondance confirmée</>
                  : <><XCircle      size={12}/> orderId ≠ mdOrder — Les valeurs ne correspondent pas</>}
              </div>

              {/* Anomalies */}
              {ctp01State.issues?.length > 0 && (
                <ul className="space-y-0.5 text-danger/80">
                  {ctp01State.issues.map((iss, i) => (
                    <li key={i} className="flex gap-1.5"><span>•</span><span>{iss}</span></li>
                  ))}
                </ul>
              )}

              {/* Réponse API complète */}
              {ctp01State.ctpResponse && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-secondary font-medium">
                    Réponse complète getOrderStatusExtended.do
                  </summary>
                  <pre className="mt-1 text-xs bg-surface3 rounded p-2 overflow-x-auto text-secondary max-h-48">
                    {JSON.stringify(ctp01State.ctpResponse, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tableau des cas ── */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>ID</th>
              <th>Description</th>
              <th>Priorité</th>
              <th>Résultat</th>
              <th>JSON valide</th>
              <th>Anomalies JSON</th>
            </tr>
          </thead>
          <tbody>
            {cases.map(tc => {
              const rc     = RESULT_CFG[tc.normalizedResult] || RESULT_CFG.pending;
              const isExp  = expanded.has(tc.tcId);
              const hasDet = tc.jsonResp || tc.comments || tc.jsonErrors?.length;

              return [
                <tr key={tc.tcId}
                    className={clsx(tc.isCritical && tc.normalizedResult !== 'pass' && 'bg-danger-dim/30')}>
                  <td>
                    {hasDet && (
                      <button onClick={() => toggle(tc.tcId)}
                        className="text-tertiary hover:text-primary transition-colors">
                        {isExp ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                      </button>
                    )}
                  </td>
                  <td className="font-mono text-xs font-semibold text-brand">{tc.tcId}</td>
                  <td className="text-sm font-medium text-primary">{tc.name}</td>
                  <td>
                    <span className={clsx('badge text-xs', PRIORITY_CFG[tc.priority] || 'badge-neutral')}>
                      {tc.priority}
                    </span>
                  </td>
                  <td><span className={clsx('badge', rc.cls)}>{rc.label}</span></td>
                  <td>
                    {tc.tcId === 'CTP-02' ? (
                      <span className="text-xs text-tertiary">—</span>
                    ) : tc.jsonResp ? (
                      <span className={clsx('badge text-xs', tc.jsonValid ? 'badge-success' : 'badge-danger')}>
                        {tc.jsonValid ? 'Oui' : 'Non'}
                      </span>
                    ) : (
                      <span className="text-xs text-tertiary">Non renseigné</span>
                    )}
                  </td>
                  <td>
                    {tc.jsonErrors?.length > 0 ? (
                      <span className="text-xs text-danger">{tc.jsonErrors.length} erreur(s)</span>
                    ) : tc.jsonValid ? (
                      <span className="text-xs text-success">OK</span>
                    ) : (
                      <span className="text-xs text-tertiary">—</span>
                    )}
                  </td>
                </tr>,

                isExp && hasDet && (
                  <tr key={`${tc.tcId}-detail`} className="bg-surface2">
                    <td colSpan={7} className="px-6 py-3 space-y-2">
                      {tc.jsonErrors?.length > 0 && (
                        <div className="text-xs space-y-1">
                          <div className="font-semibold text-danger mb-1">Anomalies JSON :</div>
                          {tc.jsonErrors.map((e, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-danger/80">
                              <span>•</span><span>{e}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {tc.jsonResp && (
                        <div>
                          <div className="text-xs font-semibold text-secondary mb-1">Réponse JSON :</div>
                          <pre className="text-xs bg-surface3 rounded p-2 overflow-x-auto text-secondary max-h-32">
                            {tc.parsedJson ? JSON.stringify(tc.parsedJson, null, 2) : tc.jsonResp}
                          </pre>
                        </div>
                      )}
                      {tc.comments && (
                        <div className="text-xs text-tertiary italic">💬 {tc.comments}</div>
                      )}
                    </td>
                  </tr>
                )
              ].filter(Boolean);
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
