// src/pages/PsmFacturationPage.jsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import client from '@/api/client';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Receipt, Download, Loader2, Trash2, RefreshCw, ChevronLeft, Play } from 'lucide-react';

const MOIS = ['','Janvier','Février','Mars','Avril','Mai','Juin',
              'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const TABS = [
  { key:'facturier', label:'Facturiers' },
  { key:'fsp',       label:'FSP' },
  { key:'smt',       label:'SMT' },
  { key:'wesettle',  label:'We-Settle' },
  { key:'acquereur', label:'Acquéreur' },
];
const fmt  = n => parseFloat(n||0).toLocaleString('fr-FR', { minimumFractionDigits:3 });
const fmtN = n => parseInt(n||0).toLocaleString('fr-FR');

export default function PsmFacturationPage() {
  const qc = useQueryClient();
  const [tab,        setTab]        = useState('facturier');
  const [mois,       setMois]       = useState(new Date().getMonth()+1);
  const [annee,      setAnnee]      = useState(new Date().getFullYear());
  const [generating, setGenerating] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selDest,    setSelDest]    = useState(null);

  const annees = Array.from({length:5},(_,i) => new Date().getFullYear()-i);

  // Liste des factures pour l'onglet courant
  const { data: facturesData, isLoading: listLoading } = useQuery({
    queryKey: ['psm-factures', tab, mois, annee],
    queryFn : () => client.get('/psm-facturation', { params:{ type_dest:tab, mois, annee } }).then(r=>r.data),
  });

  // Facturiers / FSP disponibles
  const { data: destsData } = useQuery({
    queryKey: ['psm-dests', tab, mois, annee],
    queryFn : () => {
      if (tab === 'facturier')
        return client.get('/psm-facturation/facturiers-list', { params:{ mois, annee } }).then(r=>r.data);
      if (tab === 'fsp')
        return client.get('/psm-facturation/fsp-list', { params:{ mois, annee } }).then(r=>r.data);
      return Promise.resolve(null);
    },
    enabled: tab === 'facturier' || tab === 'fsp',
  });

  // Détail d'une facture
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['psm-detail', selectedId],
    queryFn : () => client.get(`/psm-facturation/${selectedId}`).then(r=>r.data),
    enabled : !!selectedId,
  });

  const isGlobal = !['facturier','fsp'].includes(tab);
  const dests = tab === 'facturier'
    ? (destsData?.facturiers || [])
    : (destsData?.fsps || []);

  const handleGenerer = async (destinataire=null) => {
    setGenerating(true);
    try {
      const { data } = await client.post('/psm-facturation/generer', {
        type_dest: tab, mois, annee,
        ...(destinataire ? { destinataire } : {}),
      }, { timeout: 120000 });
      const ok = data.results?.filter(r=>r.statut==='ok') || [];
      const ex = data.results?.filter(r=>r.statut==='existe') || [];
      if (ok.length)  toast.success(`${ok.length} facture(s) générée(s)`);
      if (ex.length)  toast(`${ex.length} facture(s) déjà existante(s)`, { icon:'ℹ️' });
      qc.invalidateQueries(['psm-factures', tab, mois, annee]);
      if (ok.length === 1) setSelectedId(ok[0].factureId);
    } catch(e) {
      if (e.response?.status === 409) {
        toast.error('Facture déjà générée');
        if (e.response.data.factureId) setSelectedId(e.response.data.factureId);
      } else {
        toast.error(e.response?.data?.error || e.message);
      }
    } finally { setGenerating(false); }
  };

  const handleDownload = async (id, type, numero) => {
    try {
      const res = await client.get(`/psm-facturation/${id}/${type}`, { responseType:'blob', timeout:60000 });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement('a');
      a.href = url; a.download = `${numero}.${type === 'pdf' ? 'pdf' : 'xlsx'}`; a.click();
      URL.revokeObjectURL(url);
    } catch(e) { toast.error('Erreur téléchargement'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette facture ?')) return;
    try {
      await client.delete(`/psm-facturation/${id}`);
      toast.success('Supprimé');
      qc.invalidateQueries(['psm-factures', tab, mois, annee]);
      if (selectedId === id) setSelectedId(null);
    } catch(e) { toast.error('Erreur'); }
  };

  const factures = facturesData?.factures || [];
  const facture  = detailData?.facture;
  const lignes   = detailData?.lignes || [];

  return (
    <div className="space-y-4">
      {/* Onglets */}
      {!selectedId && (
        <div className="flex gap-1 border-b border-border">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setSelectedId(null); }}
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
              ? `Facture — ${facture?.numero || '…'}`
              : `Facturation Paysmart — ${TABS.find(t=>t.key===tab)?.label}`}
          </h1>
          <p className="text-xs text-tertiary mt-0.5">
            {selectedId
              ? `${MOIS[facture?.mois]||''} ${facture?.annee||''} · ${facture?.destinataire||''} · ${fmt(facture?.montant_ht)} TND HT`
              : 'Génération des factures mensuelles Paysmart'}
          </p>
        </div>
        {selectedId && (
          <div className="flex items-center gap-2">
            <button onClick={() => handleDownload(selectedId,'excel',facture?.numero)}
              className="btn-ghost btn-sm flex items-center gap-1.5">
              <Download size={13}/> Excel
            </button>
            <button onClick={() => handleDownload(selectedId,'pdf',facture?.numero)}
              className="btn-primary btn-sm flex items-center gap-1.5">
              <Receipt size={13}/> PDF
            </button>
          </div>
        )}
      </div>

      {!selectedId ? (
        <>
          {/* Sélecteur période + génération */}
          <div className="card p-4 flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-secondary mb-1">Mois</label>
              <select value={mois} onChange={e=>setMois(Number(e.target.value))}
                className="input-field text-sm w-36">
                {MOIS.slice(1).map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Année</label>
              <select value={annee} onChange={e=>setAnnee(Number(e.target.value))}
                className="input-field text-sm w-28">
                {annees.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            {isGlobal ? (
              <button onClick={() => handleGenerer()} disabled={generating}
                className="btn-primary flex items-center gap-2">
                {generating ? <Loader2 size={14} className="animate-spin"/> : <Play size={14}/>}
                {generating ? 'Génération…' : `Générer facture ${TABS.find(t=>t.key===tab)?.label}`}
              </button>
            ) : (
              <button onClick={() => handleGenerer()} disabled={generating}
                className="btn-primary flex items-center gap-2">
                {generating ? <Loader2 size={14} className="animate-spin"/> : <Play size={14}/>}
                {generating ? 'Génération…' : `Générer toutes les factures ${TABS.find(t=>t.key===tab)?.label}`}
              </button>
            )}
          </div>

          {/* Liste des destinataires (facturier/fsp) avec bouton unitaire */}
          {!isGlobal && dests.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide">
                {tab === 'facturier' ? 'Facturiers disponibles' : 'FSP disponibles'} — {MOIS[mois]} {annee}
              </div>
              <div className="flex flex-wrap gap-2 p-4">
                {dests.map(d => {
                  const exists = factures.some(f => f.destinataire === d ||
                    (d === 'CNTE' && f.destinataire === 'Paysmart_SDK'));
                  return (
                    <button key={d} onClick={() => handleGenerer(d)} disabled={generating || exists}
                      className={clsx('btn-sm flex items-center gap-1',
                        exists ? 'btn-ghost opacity-50' : 'btn-outline')}>
                      <Play size={11}/> {d === 'CNTE' && tab === 'fsp' ? 'Paysmart_SDK' : d}
                      {exists && ' ✓'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Liste des factures générées */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-xs font-semibold text-secondary uppercase tracking-wide flex items-center justify-between">
              <span>Factures générées</span>
              <button onClick={() => qc.invalidateQueries(['psm-factures',tab,mois,annee])}
                className="btn-ghost btn-sm"><RefreshCw size={12}/></button>
            </div>
            {listLoading ? (
              <div className="flex items-center justify-center h-20 gap-2 text-secondary text-sm">
                <Loader2 size={14} className="animate-spin"/> Chargement…
              </div>
            ) : !factures.length ? (
              <div className="flex items-center justify-center h-20 text-tertiary text-sm gap-2">
                <Receipt size={16} className="opacity-40"/> Aucune facture
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Numéro</th>
                    {!isGlobal && <th>Destinataire</th>}
                    <th className="text-center">Période</th>
                    <th className="text-right">Montant HT</th>
                    <th className="text-center">Date génération</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {factures.map(f => (
                    <tr key={f.id}>
                      <td className="font-mono text-sm font-semibold text-primary">{f.numero}</td>
                      {!isGlobal && <td className="font-medium">{f.destinataire}</td>}
                      <td className="text-center text-sm">{MOIS[f.mois]} {f.annee}</td>
                      <td className="text-right font-semibold">{fmt(f.montant_ht)} TND</td>
                      <td className="text-center text-xs text-secondary">
                        {new Date(f.created_at).toLocaleString('fr-FR')}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <button onClick={() => setSelectedId(f.id)}
                            className="btn-primary btn-sm">Voir</button>
                          <button onClick={() => handleDownload(f.id,'pdf',f.numero)}
                            className="btn-ghost btn-sm"><Receipt size={12}/></button>
                          <button onClick={() => handleDownload(f.id,'excel',f.numero)}
                            className="btn-ghost btn-sm"><Download size={12}/></button>
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
        // Détail facture
        detailLoading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-secondary text-sm">
            <Loader2 size={16} className="animate-spin"/> Chargement…
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-navy">
              <span className="text-sm font-semibold">Détail des prestations</span>
              <span className="text-xs text-secondary">
                {fmtN(lignes.reduce((s,l)=>s+parseInt(l.nb_transactions||0),0))} transactions · {fmt(facture?.montant_ht)} TND HT
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {facture?.type_dest !== 'facturier' && <th>Facturier</th>}
                    {['facturier','fsp'].includes(facture?.type_dest) && <th>Canal</th>}
                    <th>Mode de paiement</th>
                    <th className="text-center">Nb transactions</th>
                    <th className="text-center">Prix unit. HT (TND)</th>
                    <th className="text-right">Montant HT (TND)</th>
                    <th className="text-center">TVA (%)</th>
                    <th className="text-right">Montant TTC (TND)</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map(l => (
                    <tr key={l.id}>
                      {facture?.type_dest !== 'facturier' && <td className="font-medium">{l.facturier||'—'}</td>}
                      {['facturier','fsp'].includes(facture?.type_dest) && <td className="text-xs">{l.canal||'—'}</td>}
                      <td>{l.mode_paiement}</td>
                      <td className="text-center">{fmtN(l.nb_transactions)}</td>
                      <td className="text-center font-mono text-xs">{fmt(l.prix_unitaire_ht)}</td>
                      <td className="text-right font-semibold">{fmt(l.montant_ht)}</td>
                      <td className="text-center text-xs">{fmt(l.tva_rate)} %</td>
                      <td className="text-right font-semibold text-primary">{fmt(l.montant_ttc)}</td>
                    </tr>
                  ))}
                  <tr className="bg-primary text-white font-bold">
                    {facture?.type_dest !== 'facturier' && <td>TOTAL</td>}
                    {['facturier','fsp'].includes(facture?.type_dest) && <td></td>}
                    <td>{facture?.type_dest === 'facturier' ? 'TOTAL' : ''}</td>
                    <td className="text-center">{fmtN(lignes.reduce((s,l)=>s+parseInt(l.nb_transactions||0),0))}</td>
                    <td></td>
                    <td className="text-right">{fmt(facture?.montant_ht)} TND</td>
                    <td></td>
                    <td className="text-right">{fmt(facture?.montant_ttc)} TND</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
