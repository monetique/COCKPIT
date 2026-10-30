// src/hooks/useTransactions.js
import { useState, useCallback } from 'react';
import { useQuery }              from '@tanstack/react-query';
import { getTransactions, getStates, getStats } from '@/api/transactions';

// Date du jour (format YYYY-MM-DD)
function today() {
  return new Date().toISOString().slice(0, 10);
}
function toFrDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const INIT_FILTERS = {
  date_debut   : today(),   // ← aujourd'hui par défaut
  date_fin     : today(),   // ← aujourd'hui par défaut
  payment_state: '',
  processing_id: '',
  order_number : '',
  pan          : '',
  ip           : '',
  auth_code    : '',
};

export function useTransactions() {
  const [filters,  setFilters]  = useState(INIT_FILTERS);
  const [applied,  setApplied]  = useState(INIT_FILTERS);
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Filtres convertis pour l'API Oracle
  const apiFilters = {
    ...applied,
    date_debut: toFrDate(applied.date_debut),
    date_fin  : toFrDate(applied.date_fin),
    page, pageSize,
  };

  // Filtres pour les stats/graphiques — DATE UNIQUEMENT
  // Les graphiques reflètent la totalité des transactions de la journée,
  // indépendamment des filtres texte (marchand, action code, etc.)
  const statsFilters = {
    date_debut: toFrDate(applied.date_debut),
    date_fin  : toFrDate(applied.date_fin),
  };

  // ── Requête transactions paginées ─────────────────────
  const query = useQuery({
    queryKey : ['transactions', apiFilters],
    queryFn  : () => getTransactions(apiFilters).then(r => r.data),
    keepPreviousData: true,
    staleTime: 30_000,
  });

  // ── Requête stats agrégées (toute la sélection) ───────
  const statsQuery = useQuery({
    queryKey : ['transactions-stats', statsFilters],
    queryFn  : () => getStats(statsFilters).then(r => r.data),
    staleTime: 30_000,
    enabled  : !!(statsFilters.date_debut || statsFilters.date_fin), // déclencher dès qu'il y a une date
  });

  // ── États de paiement ─────────────────────────────────
  const statesQuery = useQuery({
    queryKey: ['payment-states'],
    queryFn : () => getStates().then(r => r.data),
    staleTime: Infinity,
  });

  const applyFilters = useCallback(() => {
    setApplied({ ...filters });
    setPage(1);
  }, [filters]);

  const resetFilters = useCallback(() => {
    setFilters(INIT_FILTERS);
    setApplied(INIT_FILTERS);
    setPage(1);
  }, []);

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const handlePageSize = useCallback((size) => {
    setPageSize(size);
    setPage(1);
  }, []);

  return {
    filters, updateFilter,
    applied, applyFilters, resetFilters,
    page, setPage, pageSize, handlePageSize,
    query, statesQuery, statsQuery,
    data    : query.data,
    stats   : statsQuery.data,
    loading : query.isFetching,
    error   : query.error,
  };
}
