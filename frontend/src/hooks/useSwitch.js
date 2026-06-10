// src/hooks/useSwitch.js
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery }   from '@tanstack/react-query';
import { getDropdowns, getSwitchTransactions, exportSwitch } from '@/api/switchApi';
import * as XLSX      from 'xlsx';
import toast          from 'react-hot-toast';

function today() { return new Date().toISOString().slice(0, 10); }

const INIT_FILTERS = {
  date_debut     : today(),
  date_fin       : today(),
  heure_debut    : '',
  heure_fin      : '',
  facturier      : 'ALL',
  etat           : 'ALL',
  fsp            : 'ALL',
  canal          : '',
  solution       : '',
  moyen          : '',
  mode           : '',
  ref_auto       : '',
  reference      : '',
  num_reservation: '',
  montant_min    : '',
  montant_max    : '',
  table_mode     : 'new', // 'new' = TO_QLIK_BI_new | 'hist' = TO_QLIK_BI
};

export function useSwitch() {
  const [filters,  setFilters]  = useState(INIT_FILTERS);
  const [applied,  setApplied]  = useState(INIT_FILTERS); // chargement immédiat avec la date du jour
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exporting,setExporting]= useState(false);
  const [allData,  setAllData]  = useState([]);   // toutes les lignes pour KPIs/charts

  // ── Dropdowns ─────────────────────────────────────────
  const dropdownsQuery = useQuery({
    queryKey            : ['switch-dropdowns'],
    queryFn             : () => getDropdowns().then(r => r.data),
    staleTime           : 30 * 60 * 1000,
    retry               : false,
    refetchOnWindowFocus: false,
  });

  // ── Transactions paginées ──────────────────────────────
  const txQuery = useQuery({
    queryKey        : ['switch-tx', applied, page, pageSize],
    queryFn         : () => getSwitchTransactions({ ...applied, page, pageSize }).then(r => r.data),
    enabled         : !!applied,
    keepPreviousData: true,
    staleTime       : 30_000,
  });

  // ── Charger toutes les données dès qu'une recherche réussit ──
  // useEffect remplace onSuccess (supprimé en React Query v5)
  const [loadingAll, setLoadingAll] = useState(false);

  useEffect(() => {
    if (!txQuery.data?.total || !applied) return;
    if (allData.length > 0) return; // déjà chargé pour cette recherche

    setLoadingAll(true);
    exportSwitch({ ...applied })
      .then(({ data }) => { if (data.success) setAllData(data.data || []); })
      .catch(() => {})
      .finally(() => setLoadingAll(false));
  }, [txQuery.data, applied]); // eslint-disable-line

  // ── KPIs calculés sur allData ──────────────────────────
  const kpis = useMemo(() => {
    const data = allData;
    if (!data.length) return null;

    const total    = txQuery.data?.total || 0;
    const montant  = data.reduce((s, r) => s + (Number(r['Montant']) || 0), 0);
    const moyen    = data.length ? montant / data.length : 0;
    const succes   = data.filter(r => {
      const v = (r['Etat'] || '').toUpperCase();
      return ['OK','SUCCESS','PAID','APPROVED','ACCEPTED','VALIDE','DEPOSITED'].some(s => v.includes(s));
    }).length;
    const facturiers = new Set(data.map(r => r['Facturier']).filter(Boolean)).size;

    // Pic/creux par minute
    const perMin = {};
    data.forEach(r => {
      const d = r['Date'], h = r['Heure'];
      if (!d || !h) return;
      const key = `${String(d).trim()} ${String(h).trim().slice(0, 5)}`;
      perMin[key] = (perMin[key] || 0) + 1;
    });
    const mv = Object.values(perMin);

    return {
      total,
      montant,
      moyen,
      succesRate: data.length ? Math.round(succes / data.length * 100) : 0,
      facturiers,
      picMax : mv.length ? Math.max(...mv) : 0,
      picMin : mv.length ? Math.min(...mv) : 0,
    };
  }, [allData, txQuery.data?.total]);

  // ── Actions ────────────────────────────────────────────
  const search = useCallback(() => {
    setApplied({ ...filters });
    setPage(1);
    setAllData([]); // vider pour forcer le rechargement analytics
  }, [filters]);

  const reset = useCallback(() => {
    setFilters(INIT_FILTERS);
    setApplied(null);
    setAllData([]);
    setPage(1);
  }, []);

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const handlePageSize = useCallback((size) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const exportToExcel = useCallback(async () => {
    if (!applied) return;
    setExporting(true);
    const toastId = toast.loading('Export en cours…');
    try {
      const { data } = await exportSwitch({ ...applied });
      if (!data.success) throw new Error(data.error);

      const rows = data.data.map(r => ({
        'Date'          : r['Date']           || '',
        'Heure'         : r['Heure']          || '',
        'FSP'           : r['FSP']            || '',
        'Facturier'     : r['Facturier']      || '',
        'Canal'         : r['Canal']          || '',
        'Solution'      : r['Solution']       || '',
        'Moyen'         : r['Moyen']          || '',
        'Mode'          : r['Mode']           || '',
        'Etat'          : r['Etat']           || '',
        'Montant'       : Number(r['Montant']) || 0,
        'Référence'     : r['Reference']      || '',
        'Réf. Auto'     : r['Ref_Auto']       || '',
        'N° Réservation': r['Num_Reservation']|| '',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Array(13).fill({ wch: 18 });
      XLSX.utils.book_append_sheet(wb, ws, 'SwitchBI');
      XLSX.writeFile(wb, `ClicToPay_SwitchBI_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`${rows.length.toLocaleString('fr-FR')} lignes exportées`, { id: toastId });
    } catch(e) {
      toast.error('Erreur export : ' + e.message, { id: toastId });
    } finally {
      setExporting(false);
    }
  }, [applied]);

  return {
    filters, updateFilter, search, reset,
    page, setPage, pageSize, handlePageSize,
    applied,
    txQuery, dropdownsQuery,
    data    : txQuery.data,
    loading : txQuery.isFetching,
    allData, kpis,
    loadingAll,
    exporting, exportToExcel,
  };
}
