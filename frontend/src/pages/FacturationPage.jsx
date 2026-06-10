// src/pages/FacturationPage.jsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import client from '@/api/client';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { FileText, Download, Loader2, Trash2, RefreshCw, ChevronLeft, Receipt } from 'lucide-react';

const MOIS = ['','Janvier','Février','Mars','Avril','Mai','Juin',
              'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const CANAL_LABEL = { wallet:'Wallet Mobile', ussd:'USSD / App Opérateurs', ctp:'Web / Cartes bancaires' };
const CANAL_COLOR = { wallet:'badge-info', ussd:'badge-warning', ctp:'badge-success' };

const fmt  = n => parseFloat(n||0).toLocaleString('fr-FR', { minimumFractionDigits:3 });
const fmtN = n => parseInt(n||0).toLocaleString('fr-FR');


// ── Composant vue détail facture globale ─────────────────
function FactureGlobaleDetail({ lignes, facture, fmt, fmtN }) {
  const ctp = lignes.filter(l => l.rubrique === 'ctp');
  const psmWeb    = lignes.filter(l => l.rubrique === 'psm' && (l.canal||'').toUpperCase() !== 'USSD');
  const psmUssd   = lignes.filter(l => l.rubrique === 'psm' && (l.canal||'').toUpperCase() === 'USSD');

  const Section = ({ title, rows, color }) => (
    <div className="card overflow-hidden">
      <div className={clsx('px-4 py-3 border-b border-border flex items-center justify-between', color)}>
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="text-xs text-white/80">
          {fmtN(rows.reduce((s,l) => s+parseInt(l.nb_transactions||0), 0))} transactions ·
          {' '}{fmt(rows.reduce((s,l) => s+parseFloat(l.montant_total||0), 0))} TND
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Libellé</th>
              <th className="text-center">Nb transactions</th>
              <th className="text-center">Commission unit.</th>
              <th className="text-center">Montant commission</th>
              <th className="text-center">Émetteur unit.</th>
              <th className="text-center">Montant émetteur</th>
              <th className="text-center">Acquéreur unit.</th>
              <th className="text-center">Montant acquéreur</th>
              <th className="text-center">SMT unit.</th>
              <th className="text-center">Montant SMT</th>
              {rows.some(l => parseFloat(l.operateur||0) > 0) && <>
                <th className="text-center">Opérateur unit.</th>
                <th className="text-center">Montant opérateur</th>
              </>}
              <th className="text-right">Total (TND)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(l => (
              <tr key={l.id}>
                <td className="font-medium">{l.label}</td>
                <td className="text-center">{fmtN(l.nb_transactions)}</td>
                <td className="text-center font-mono text-xs">{fmt(l.commission)}</td>
                <td className="text-center font-mono text-xs">{fmt(l.montant_commission)}</td>
                <td className="text-center font-mono text-xs">{fmt(l.emetteur)}</td>
                <td className="text-center font-mono text-xs">{fmt(l.montant_emetteur)}</td>
                <td className="text-center font-mono text-xs">{fmt(l.acquereur)}</td>
                <td className="text-center font-mono text-xs">{fmt(l.montant_acquereur)}</td>
                <td className="text-center font-mono text-xs">{fmt(l.smt)}</td>
                <td className="text-center font-mono text-xs">{fmt(l.montant_smt)}</td>
                {rows.some(r => parseFloat(r.operateur||0) > 0) && <>
                  <td className="text-center font-mono text-xs">{fmt(l.operateur)}</td>
                  <td className="text-center font-mono text-xs">{fmt(l.montant_operateur)}</td>
                </>}
                <td className="text-right font-semibold text-primary">{fmt(l.montant_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {ctp.length > 0 && (
        <Section title="Rubrique 1 — ClicToPay Direct (cartes hors Paysmart)"
          rows={ctp} color="bg-green-700"/>
      )}
      {psmWeb.length > 0 && (
        <Section title="Rubrique 2a — Paysmart WEB / MOBILE (Cartes & Wallets & Virements)"
          rows={psmWeb} color="bg-cyan-700"/>
      )}
      {psmUssd.length > 0 && (
        <Section title="Rubrique 2b — Paysmart USSD / App Opérateurs"
          rows={psmUssd} color="bg-amber-600"/>
      )}
      {/* Récapitulatif */}
      <div className="card p-5">
        <div className="text-sm font-semibold text-primary mb-4">Récapitulatif</div>
        <table className="data-table">
          <thead><tr>
            <th>Rubrique</th>
            <th className="text-center">Nb transactions</th>
            <th className="text-right">Montant total (TND)</th>
          </tr></thead>
          <tbody>
            {[
              { label:'Rubrique 1 — CTP Direct', rows: ctp },
              { label:'Rubrique 2 — Paysmart', rows: [...psmWeb, ...psmUssd] },
            ].map(({ label, rows }) => rows.length > 0 && (
              <tr key={label}>
                <td>{label}</td>
                <td className="text-center">{fmtN(rows.reduce((s,l)=>s+parseInt(l.nb_transactions||0),0))}</td>
                <td className="text-right font-semibold">{fmt(rows.reduce((s,l)=>s+parseFloat(l.montant_total||0),0))}</td>
              </tr>
            ))}
            <tr className="bg-primary text-white font-bold">
              <td>TOTAL GÉNÉRAL</td>
              <td className="text-center">{fmtN(lignes.reduce((s,l)=>s+parseInt(l.nb_transactions||0),0))}</td>
              <td className="text-right">{fmt(facture?.montant_total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FacturationPage() {
  const qc = useQueryClient();
  const [selectedId,  setSelectedId]  = useState(null);
  const [generating,  setGenerating]  = useState(false);
  const [mois,        setMois]        = useState(new Date().getMonth()+1);
  const [annee,       setAnnee]       = useState(new Date().getFullYear());
  const [tab,         setTab]         = useState('fsp');

  const { data: facturesData, isLoading } = useQuery({
    queryKey: ['factures', tab],
    queryFn : () => client.get(tab === 'globale' ? '/facturation-globale' : '/facturation').then(r => r.data),
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['facture-detail', selectedId, tab],
    queryFn : () => {
      const base = tab === 'globale' ? '/facturation-globale' : '/facturation';
      return client.get(`${base}/${selectedId}`).then(r => r.data);
    },
    enabled : !!selectedId,
  });

  const handleGenerer = async () => {
    setGenerating(true);
    try {
      const endpoint = tab === 'globale' ? '/facturation-globale/generer' : '/facturation/generer';
      const { data } = await client.post(endpoint, { mois, annee });
      toast.success(`Facture ${data.numero} générée`);
      qc.invalidateQueries(['factures', tab]);
      setSelectedId(data.factureId);
    } catch(e) {
      const msg = e.response?.data?.error || e.message;
      if (e.response?.status === 409) {
        toast.error('Facture déjà générée pour ce mois');
        setSelectedId(e.response.data.factureId);
      } else {
        toast.error(msg);
      }
    } finally { setGenerating(false); }
  };

  const handleDownload = async (type) => {
    try {
      const base = tab === 'globale' ? '/facturation-globale' : '/facturation';
      const res = await client.get(`${base}/${selectedId}/${type}`, { responseType:'blob', timeout:60000 });
      const facture = detailData?.facture;
      const ext     = type === 'pdf' ? 'pdf' : 'xlsx';
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement('a');
      a.href = url; a.download = `${facture?.numero || 'facture'}.${ext}`; a.click();
      URL.revokeObjectURL(url);
    } catch(e) { toast.error('Erreur téléchargement'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette facture ?')) return;
    try {
      const base = tab === 'globale' ? '/facturation-globale' : '/facturation';
      await client.delete(`${base}/${id}`);
      toast.success('Facture supprimée');
      qc.invalidateQueries(['factures', tab]);
      if (selectedId === id) setSelectedId(null);
    } catch(e) { toast.error('Erreur suppression'); }
  };

  const factures = facturesData?.factures || [];
  const facture  = detailData?.facture;
  const lignes   = detailData?.lignes || [];

  // Grouper les lignes par canal
  const byCanal = {};
  lignes.forEach(l => {
    if (!byCanal[l.canal]) byCanal[l.canal] = [];
    byCanal[l.canal].push(l);
  });

  const annees = Array.from({length:5}, (_,i) => new Date().getFullYear() - i);

  return (
    <div className="space-y-4">
      {/* Onglets */}
      {!selectedId && (
        <div className="flex gap-1 border-b border-border pb-0">
          {[
            { key:'fsp',     label:'Facture par FSP' },
            { key:'globale', label:'Facture globale' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-secondary hover:text-primary')}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {selectedId && (
            <button onClick={() => setSelectedId(null)} className="btn-ghost btn-sm flex items-center gap-1 mb-2">
              <ChevronLeft size={14}/> Retour
            </button>
          )}
          <h1 className="text-lg font-semibold text-primary flex items-center gap-2">
            <Receipt size={18}/>
            {selectedId
              ? `${tab === 'globale' ? 'Facture Globale' : 'Facture'} — ${facture?.numero || '…'}`
              : tab === 'globale' ? 'Facturation globale' : 'Facturation mensuelle'}
          </h1>
          <p className="text-xs text-tertiary mt-0.5">
            {selectedId
              ? `${MOIS[facture?.mois] || ''} ${facture?.annee || ''} — Total : ${fmt(facture?.montant_total)} TND`
              : tab === 'globale'
                ? 'Facture sans détail FSP — répartition par canal et moyen de paiement'
                : 'Génération des factures de commissions — Inscriptions scolaires'}
          </p>
        </div>
        {selectedId && (
          <div className="flex items-center gap-2">
            <button onClick={() => handleDownload('excel')} className="btn-ghost btn-sm flex items-center gap-1.5">
              <Download size={13}/> Excel
            </button>
            <button onClick={() => handleDownload('pdf')} className="btn-primary btn-sm flex items-center gap-1.5">
              <FileText size={13}/> PDF
            </button>
          </div>
        )}
      </div>

      {!selectedId ? (
        <>
          {/* Formulaire génération */}
          <div className="card p-5">
            <div className="text-sm font-semibold text-primary mb-4">Générer une nouvelle facture</div>
            <div className="flex items-end gap-3">
              <div>
                <label className="block text-xs text-secondary mb-1">Mois</label>
                <select value={mois} onChange={e => setMois(Number(e.target.value))}
                  className="input-field text-sm w-36">
                  {MOIS.slice(1).map((m,i) => (
                    <option key={i+1} value={i+1}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-secondary mb-1">Année</label>
                <select value={annee} onChange={e => setAnnee(Number(e.target.value))}
                  className="input-field text-sm w-28">
                  {annees.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <button onClick={handleGenerer} disabled={generating}
                className="btn-primary flex items-center gap-2">
                {generating ? <Loader2 size={14} className="animate-spin"/> : <Receipt size={14}/>}
                {generating ? 'Génération…' : 'Générer la facture'}
              </button>
            </div>
          </div>

          {/* Liste des factures */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide flex items-center justify-between">
              <span>Factures générées</span>
              <button onClick={() => qc.invalidateQueries(['factures'])} className="btn-ghost btn-sm">
                <RefreshCw size={12}/>
              </button>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center h-24 gap-2 text-secondary text-sm">
                <Loader2 size={14} className="animate-spin"/> Chargement…
              </div>
            ) : !factures.length ? (
              <div className="flex flex-col items-center justify-center h-24 gap-2 text-tertiary text-sm">
                <Receipt size={20} className="opacity-40"/>
                Aucune facture générée
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Numéro</th>
                    <th className="text-center">Période</th>
                    <th className="text-center">Montant total</th>
                    <th className="text-center">Généré par</th>
                    <th className="text-center">Date</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {factures.map(f => (
                    <tr key={f.id}>
                      <td className="font-mono text-sm font-semibold text-primary">{f.numero}</td>
                      <td className="text-center text-sm">{MOIS[f.mois]} {f.annee}</td>
                      <td className="text-center font-semibold text-primary">
                        {fmt(f.montant_total)} <span className="text-xs text-tertiary">TND</span>
                      </td>
                      <td className="text-center text-xs text-secondary">
                        {f.prenom} {f.nom}
                      </td>
                      <td className="text-center text-xs text-secondary">
                        {new Date(f.created_at).toLocaleString('fr-FR')}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <button onClick={() => setSelectedId(f.id)}
                            className="btn-primary btn-sm">Voir</button>
                          <button onClick={() => handleDelete(f.id)}
                            className="btn-danger btn-sm"><Trash2 size={12}/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          {detailLoading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-secondary text-sm">
              <Loader2 size={16} className="animate-spin"/> Chargement…
            </div>
          ) : tab === 'globale' ? (
            <FactureGlobaleDetail lignes={lignes} facture={facture} fmt={fmt} fmtN={fmtN}/>
          ) : (
            <>
              {/* Détail par canal */}
              {['wallet','ussd','ctp'].map(canal => {
                const rows = byCanal[canal] || [];
                if (!rows.length) return null;
                const totalNb = rows.reduce((s,l) => s+parseInt(l.nb_transactions||0), 0);
                const totalMt = rows.reduce((s,l) => s+parseFloat(l.montant_total||0), 0);
                const hasOp   = canal === 'ussd';
                return (
                  <div key={canal} className="card overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <span className="text-sm font-semibold text-primary">
                        {CANAL_LABEL[canal]}
                      </span>
                      <span className={clsx('badge text-xs', CANAL_COLOR[canal])}>
                        {fmtN(totalNb)} transactions · {fmt(totalMt)} TND
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Partenaire / FSP</th>
                            <th className="text-center">Nb transactions</th>
                            <th className="text-center">Commission unit.</th>
                            <th className="text-center">Montant commission</th>
                            <th className="text-center">Émetteur unit.</th>
                            <th className="text-center">Montant émetteur</th>
                            <th className="text-center">Acquéreur unit.</th>
                            <th className="text-center">Montant acquéreur</th>
                            <th className="text-center">SMT unit.</th>
                            <th className="text-center">Montant SMT</th>
                            {hasOp && <>
                              <th className="text-center">Opérateur unit.</th>
                              <th className="text-center">Montant opérateur</th>
                            </>}
                            <th className="text-right">Total (TND)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(l => (
                            <tr key={l.id}>
                              <td className="font-medium">{l.fsp}</td>
                              <td className="text-center">{fmtN(l.nb_transactions)}</td>
                              <td className="text-center font-mono text-xs">{fmt(l.commission)}</td>
                              <td className="text-center font-mono text-xs">{fmt(l.montant_commission)}</td>
                              <td className="text-center font-mono text-xs">{fmt(l.emetteur)}</td>
                              <td className="text-center font-mono text-xs">{fmt(l.montant_emetteur)}</td>
                              <td className="text-center font-mono text-xs">{fmt(l.acquereur)}</td>
                              <td className="text-center font-mono text-xs">{fmt(l.montant_acquereur)}</td>
                              <td className="text-center font-mono text-xs">{fmt(l.smt)}</td>
                              <td className="text-center font-mono text-xs">{fmt(l.montant_smt)}</td>
                              {hasOp && <>
                                <td className="text-center font-mono text-xs">{fmt(l.operateur)}</td>
                                <td className="text-center font-mono text-xs">{fmt(l.montant_operateur)}</td>
                              </>}
                              <td className="text-right font-semibold text-primary">{fmt(l.montant_total)}</td>
                            </tr>
                          ))}
                          <tr className="bg-surface-hover font-semibold">
                            <td>Sous-total</td>
                            <td className="text-center">{fmtN(totalNb)}</td>
                            <td colSpan={hasOp ? 9 : 7}></td>
                            <td className="text-right text-primary">{fmt(totalMt)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {/* Récapitulatif */}
              <div className="card p-5">
                <div className="text-sm font-semibold text-primary mb-4">Récapitulatif</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th className="text-center">Nb transactions</th>
                      <th className="text-right">Montant total (TND)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['wallet','ussd','ctp'].map(canal => {
                      const rows = byCanal[canal] || [];
                      if (!rows.length) return null;
                      return (
                        <tr key={canal}>
                          <td>{CANAL_LABEL[canal]}</td>
                          <td className="text-center">
                            {fmtN(rows.reduce((s,l)=>s+parseInt(l.nb_transactions||0),0))}
                          </td>
                          <td className="text-right font-semibold">
                            {fmt(rows.reduce((s,l)=>s+parseFloat(l.montant_total||0),0))}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-primary text-white font-bold">
                      <td>TOTAL GÉNÉRAL</td>
                      <td className="text-center">
                        {fmtN(lignes.reduce((s,l)=>s+parseInt(l.nb_transactions||0),0))}
                      </td>
                      <td className="text-right">{fmt(facture?.montant_total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
