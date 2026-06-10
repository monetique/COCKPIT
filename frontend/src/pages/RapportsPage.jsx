// src/pages/RapportsPage.jsx
import { useQuery } from '@tanstack/react-query';
import client from '@/api/client';
import { FileText, Download, Loader2, RefreshCw } from 'lucide-react';

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(0) + ' Ko';
  return (bytes/1024/1024).toFixed(1) + ' Mo';
}

function fmtDate(d) {
  return new Date(d).toLocaleString('fr-FR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

export default function RapportsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey : ['rapports-list'],
    queryFn  : () => client.get('/rapports').then(r => r.data),
    refetchInterval: 60 * 1000,
  });

  const rapports = data?.rapports || [];

  const handleDownload = async (nom) => {
    try {
      const res = await client.get(`/rapports/${encodeURIComponent(nom)}`, {
        responseType: 'blob',
      });
      const url  = URL.createObjectURL(res.data);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      alert('Erreur téléchargement : ' + e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-primary">Rapports sauvegardés</h1>
          <p className="text-xs text-tertiary mt-0.5">
            Rapports PDF des inscriptions scolaires — générés automatiquement toutes les heures
          </p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="btn-ghost btn-sm flex items-center gap-1.5">
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''}/>
          Actualiser
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-secondary text-sm">
            <Loader2 size={16} className="animate-spin"/> Chargement…
          </div>
        ) : rapports.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-tertiary text-sm">
            <FileText size={24} className="opacity-40"/>
            Aucun rapport disponible
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Rapport</th>
                <th className="text-center">Taille</th>
                <th className="text-center">Généré le</th>
                <th className="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {rapports.map(r => (
                <tr key={r.nom}>
                  <td>
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-danger shrink-0"/>
                      <span className="font-mono text-xs text-primary">{r.nom}</span>
                    </div>
                  </td>
                  <td className="text-center text-xs text-secondary">{fmtSize(r.taille)}</td>
                  <td className="text-center text-xs text-secondary">{fmtDate(r.date)}</td>
                  <td className="text-center">
                    <button
                      onClick={() => handleDownload(r.nom)}
                      className="btn-primary btn-sm flex items-center gap-1.5 mx-auto">
                      <Download size={12}/>
                      Télécharger
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-xs text-tertiary text-center">
        {rapports.length > 0 && `${rapports.length} rapport(s) disponible(s)`}
      </div>
    </div>
  );
}
