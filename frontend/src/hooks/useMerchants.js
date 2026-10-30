// src/hooks/useMerchants.js
import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient }       from '@tanstack/react-query';
import * as XLSX   from 'xlsx';
import { getMerchantsProd, getMerchantsTest } from '@/api/merchants';
import { getTracking, importTracking, exportTracking } from '@/api/tracking';
import toast from 'react-hot-toast';

// Trouver l'index d'une colonne par son nom dans une feuille SheetJS
function getColIndex(ws, headerName) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell && String(cell.v || '').trim() === headerName) return c;
  }
  return -1;
}

// Normaliser un numéro d'affiliation :
// - Si purement numérique sur 9 chiffres → ajouter "0" à gauche → 10 chiffres
// - Si alphanumérique (ex: "04MG081276") → conserver tel quel
// - Sinon → conserver tel quel
function normalizeId(v) {
  if (!v) return '';
  const val = String(v).trim();
  if (!val) return '';
  const onlyDigits = val.replace(/\D/g, '');
  if (onlyDigits === val) {
    // Purement numérique
    if (val.length === 9) return '0' + val;
    return val;
  }
  // Alphanumérique → conserver tel quel
  return val;
}

export function useMerchants() {
  const qc = useQueryClient();

  // ── État local ────────────────────────────────────────
  const [excelRows,    setExcelRows]    = useState([]);
  const [importing,    setImporting]    = useState(false);
  const [filterName,   setFilterName]   = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [dbSearch,     setDbSearch]     = useState('');
  const [dbStatut,     setDbStatut]     = useState('all');
  const [dbBanque,     setDbBanque]     = useState('');  // filtre par code banque (2 chars)
  const [activeTab,    setActiveTab]    = useState('db'); // 'db' | 'excel'

  // ── Données Oracle ────────────────────────────────────
  const prodQuery = useQuery({
    queryKey: ['merchants-prod'],
    queryFn : () => getMerchantsProd().then(r => r.data.data || []),
    staleTime: 5 * 60_000,
  });
  const testQuery = useQuery({
    queryKey: ['merchants-test'],
    queryFn : () => getMerchantsTest().then(r => r.data.data || []),
    staleTime: 5 * 60_000,
  });

  // ── Données PostgreSQL (tracking) ────────────────────
  const trackingQuery = useQuery({
    queryKey: ['tracking', dbStatut, dbSearch, dbBanque],
    queryFn : () => getTracking({
      statut: dbStatut !== 'all' ? dbStatut : undefined,
      search: dbSearch || undefined,
      banque: dbBanque || undefined,
      limit : 500,
    }).then(r => r.data),
    staleTime: 10_000,
  });

  // ── Maps Oracle normalisés ────────────────────────────
  const prodMap = useMemo(() => {
    const m = {};
    (prodQuery.data || []).forEach(r => {
      const k = normalizeId(r.PROCESSING_ID);
      if (k) m[k] = r;
    });
    return m;
  }, [prodQuery.data]);

  const testMap = useMemo(() => {
    const m = {};
    (testQuery.data || []).forEach(r => {
      const k = normalizeId(r.PROCESSING_ID);
      if (k) m[k] = r;
    });
    return m;
  }, [testQuery.data]);

  // ── Map Oracle TEST par MERCHANTLOGIN (login = raison sociale) ──
  const testLoginMap = useMemo(() => {
    const m = {};
    (testQuery.data || []).forEach(r => {
      // MERCHANTLOGIN normalisé en minuscules pour comparaison insensible à la casse
      const login = String(r.MERCHANTLOGIN || '').trim().toLowerCase();
      if (login) m[login] = r;
    });
    return m;
  }, [testQuery.data]);

  // ── Import fichier Excel ──────────────────────────────
  const importExcel = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, {
            type    : 'binary',
            cellText: true,
            raw     : false,
          });
          const ws = wb.Sheets[wb.SheetNames[0]];

          // Trouver l'index de la colonne Affiliation
          const affColIdx = getColIndex(ws, 'Affiliation');
          const range     = XLSX.utils.decode_range(ws['!ref'] || 'A1');

          // Lire les lignes normalement
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

          // Corriger la colonne Affiliation ligne par ligne
          // SheetJS peut tronquer les valeurs alphanumériques si la cellule
          // est formatée comme nombre — on utilise .w (valeur affichée) ou .v (valeur brute)
          if (affColIdx >= 0) {
            rows.forEach((row, i) => {
              const cellAddr = XLSX.utils.encode_cell({ r: i + 1, c: affColIdx });
              const cell     = ws[cellAddr];
              if (cell) {
                // Priorité : .w (valeur formatée Excel) > .v (valeur brute)
                const rawVal = cell.w || String(cell.v ?? '');
                row['Affiliation'] = rawVal.trim();
              }
            });
          }

          setExcelRows(rows);
          setActiveTab('excel');
          resolve(rows.length);
        } catch(err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsBinaryString(file);
    });
  }, []);

  const clearExcel = useCallback(() => {
    setExcelRows([]);
    setActiveTab('db');
  }, []);

  // ── Normaliser terminal sur 10 chiffres ───────────────
  function normalizeTerminal(v) {
    if (!v) return '';
    const digits = String(v).replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length < 10) return digits.padStart(10, '0');
    return digits;
  }

  // ── Enrichissement lignes Excel ───────────────────────
  // Règles :
  // 1. Email : champ Email du fichier Excel en priorité, sinon Webmaster
  // 2. Terminal : padStart 10 chiffres avec "0" si < 10 chiffres
  // 3. Statut Oracle :
  //    - Si Affiliation normalisée = PROCESSING_ID Oracle PROD → statut 'prod'
  //    - Sinon si Raison Sociale Excel = MERCHANTLOGIN Oracle TEST → statut 'test'
  //    - Sinon → 'absent'
  const enriched = useMemo(() => {
    if (!excelRows.length) return [];
    return excelRows.map(row => {
      // ── 1. Affiliation (Processing ID) ────────────────
      const rawId  = String(row['Affiliation'] || row['Processing ID'] || '').trim();
      const normId = normalizeId(rawId);

      // ── 2. Email : Email d'abord, Webmaster en fallback ─
      const emailExcel    = String(row['Email']     || '').trim();
      const webmasterExcel= String(row['Webmaster'] || '').trim();
      const email         = emailExcel || webmasterExcel;

      // ── 3. Terminal normalisé sur 10 chiffres ─────────
      const rawTerminal  = String(row['Numero Terminal'] || '').trim();
      const normTerminal = normalizeTerminal(rawTerminal);

      // ── 4. Statut Oracle ──────────────────────────────
      // Règle A : Affiliation Excel == PROCESSING_ID Oracle PROD
      const inProd = normId ? prodMap[normId] : null;

      // Règle B (si pas en PROD) : Raison Sociale Excel == MERCHANTLOGIN Oracle TEST
      const raisonSociale   = String(row['Raison Sociale'] || '').trim();
      const raisonNormalized= raisonSociale.toLowerCase();
      const inTest = !inProd
        ? (normId ? testMap[normId] : null) || testLoginMap[raisonNormalized] || null
        : (normId ? testMap[normId] : null);

      let oracleStatus = 'absent';
      if (inProd && inTest) oracleStatus = 'both';
      else if (inProd)      oracleStatus = 'prod';
      else if (inTest)      oracleStatus = 'test';

      return {
        ...row,
        _rawId          : rawId,
        _normId         : normId,
        _email          : email,
        _emailExcel     : emailExcel,
        _webmaster      : webmasterExcel,
        _raisonSociale  : raisonSociale,
        _terminal       : normTerminal,
        _terminalRaw    : rawTerminal,
        _url            : (() => { const v = String(row['URL'] || '').trim(); return (v && !v.includes('@')) ? v : ''; })(),
        _mcc            : String(row['MCC'] || '').trim(),
        _status         : oracleStatus,
        _prodData       : inProd || null,
        _testData       : inTest || null,
        _oracleProdId   : inProd?.PROCESSING_ID || null,
        _oracleTestLogin: inTest?.MERCHANTLOGIN || null,
        // Règle 4 : Date de création depuis le fichier Excel
        _dateCreation   : String(row['Date Creation'] || row['Date Création'] || '').trim(),
      };
    });
  }, [excelRows, prodMap, testMap, testLoginMap]);

  // ── Filtrage Excel ────────────────────────────────────
  const filteredExcel = useMemo(() => {
    let rows = enriched;
    if (filterStatus !== 'all') {
      rows = rows.filter(r =>
        filterStatus === 'absent' ? r._status === 'absent'
        : filterStatus === 'prod' ? (r._status === 'prod' || r._status === 'both')
        : filterStatus === 'test' ? (r._status === 'test' || r._status === 'both')
        : true
      );
    }
    if (filterName.trim()) {
      const q = filterName.trim().toLowerCase();
      rows = rows.filter(r =>
        r._raisonSociale.toLowerCase().includes(q)
        || String(r._normId).includes(q)
      );
    }
    return rows;
  }, [enriched, filterStatus, filterName]);

  const excelStats = useMemo(() => ({
    total : enriched.length,
    prod  : enriched.filter(r => r._status === 'prod'  || r._status === 'both').length,
    test  : enriched.filter(r => r._status === 'test'  || r._status === 'both').length,
    absent: enriched.filter(r => r._status === 'absent').length,
  }), [enriched]);

  // ── Importer vers PostgreSQL ──────────────────────────
  const importToDB = useCallback(async () => {
    if (!enriched.length) return;
    setImporting(true);
    const toastId = toast.loading('Import en cours…');
    try {
      // N'envoyer que les champs nécessaires (pas les colonnes brutes Excel)
      const slim = enriched.map(r => ({
        _normId       : r._normId,
        _rawId        : r._rawId,
        _raisonSociale: r._raisonSociale,
        _email        : r._email,
        _emailExcel   : r._emailExcel,
        _webmaster    : r._webmaster,
        _terminal     : r._terminal,       // normalisé 10 chiffres
        _url          : r._url,
        _mcc          : r._mcc,
        _status       : r._status,
        _dateCreation : r._dateCreation,   // Date Creation du fichier Excel
        'Adresse'     : r['Adresse']     || '',
        'Telephone'   : r['Telephone']   || '',
        'RNE'         : r['RNE']         || '',
        'Webmaster'   : r['Webmaster']   || '',
        'Email'       : r['Email']       || '',
        'Ajouter Par' : r['Ajouter Par'] || '',
        'Type Cartes' : r['Type Cartes'] || '',
      }));

      console.log(`Import de ${slim.length} marchands...`);

      // Envoi par chunks de 100 pour éviter les timeouts proxy/réseau
      const CHUNK_SIZE = 100;
      let totalInserted = 0, totalUpdated = 0, totalUnchanged = 0, totalErrors = 0;

      for (let i = 0; i < slim.length; i += CHUNK_SIZE) {
        const chunk     = slim.slice(i, i + CHUNK_SIZE);
        const progress  = Math.round(((i + chunk.length) / slim.length) * 100);
        toast.loading(`Import en cours… ${progress}% (${i + chunk.length}/${slim.length})`, { id: toastId });

        const { data } = await importTracking(chunk);
        if (!data.success) throw new Error(data.error || 'Erreur serveur');

        totalInserted  += data.inserted  || 0;
        totalUpdated   += data.updated   || 0;
        totalUnchanged += data.unchanged || 0;
        totalErrors    += data.errors    || 0;
      }

      toast.success(
        `Import terminé — ${totalInserted} nouveau(x) · ${totalUpdated} mis à jour · ${totalUnchanged} inchangé(s)${totalErrors ? ` · ${totalErrors} erreur(s)` : ''}`,
        { id: toastId, duration: 5000 }
      );

      await qc.invalidateQueries({ queryKey: ['tracking'], refetchType: 'all' });
      await qc.refetchQueries({ queryKey: ['tracking'] });
      setActiveTab('db');
    } catch(e) {
      const msg = e.response?.data?.error || e.message;
      console.error('Import error:', msg);
      toast.error('Erreur import : ' + msg, { id: toastId });
    } finally {
      setImporting(false);
    }
  }, [enriched, qc]);

  // ── Exporter depuis PostgreSQL vers Excel ─────────────
  const exportFromDB = useCallback(async () => {
    const toastId = toast.loading('Export en cours…');
    try {
      const { data } = await exportTracking();
      if (!data.success) throw new Error(data.error);

      const STATUT_LABELS = {
        en_attente       : 'En attente',
        prise_en_charge  : 'Prise en charge',
        recettes_envoyees: 'Recettes envoyées',
        recettes_recues  : 'Recettes reçues',
        valide           : 'Validé',
        banque_notifiee  : 'Banque notifiée',
        en_production    : 'En production',
      };

      const fmtDate = (v) => v ? new Date(v).toLocaleString('fr-FR') : '';

      const rows = data.data.map(r => ({
        'Affiliation'            : r.processing_id,
        'Raison Sociale'         : r.raison_sociale,
        'Numero Terminal'        : r.numero_terminal,
        'Email / Webmaster'      : r.email_contact || r.webmaster,
        'URL'                    : r.url,
        'MCC'                    : r.mcc,
        'Banque'                 : r.bank_name,
        'Oracle PROD'            : r.oracle_prod ? 'Oui' : 'Non',
        'Oracle TEST'            : r.oracle_test ? 'Oui' : 'Non',
        'Statut'                 : STATUT_LABELS[r.statut] || r.statut,
        'Date import'            : fmtDate(r.date_import),
        'Date prise en charge'   : fmtDate(r.date_prise_en_charge),
        'Date envoi recettes'    : fmtDate(r.date_envoi_recettes),
        'Date réception recettes': fmtDate(r.date_reception_recettes),
        'Date validation'        : fmtDate(r.date_validation),
        'Date notif. banque'     : fmtDate(r.date_notif_banque),
        'Date production'        : fmtDate(r.date_production),
        'Réf. TEST'              : r.tracking_ref_test,
        'Réf. PROD'              : r.tracking_ref_prod,
        'Notes'                  : r.notes,
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Array(20).fill({ wch: 20 });
      XLSX.utils.book_append_sheet(wb, ws, 'Marchands');
      XLSX.writeFile(wb, `CTP_Marchands_${new Date().toISOString().slice(0,10)}.xlsx`);
      toast.success(`${rows.length} marchands exportés`, { id: toastId });
    } catch(e) {
      toast.error('Erreur export : ' + e.message, { id: toastId });
    }
  }, []);

  return {
    // Oracle
    prodQuery, testQuery,
    prodCount: prodQuery.data?.length || 0,
    testCount: testQuery.data?.length || 0,
    // DB
    trackingQuery,
    dbMerchants : (trackingQuery.data?.merchants || []).map(m => {
      // Règle générale : oracle_prod = true → afficher en_production
      if (m.oracle_prod && m.statut !== 'en_production') {
        return { ...m, statut: 'en_production' };
      }
      // oracle_test = true + en_attente → afficher recettes_envoyees
      if (m.oracle_test && !m.oracle_prod && m.statut === 'en_attente') {
        return { ...m, statut: 'recettes_envoyees' };
      }
      return m;
    }),
    dbTotal     : trackingQuery.data?.total     || 0,
    dbSearch, setDbSearch,
    dbStatut, setDbStatut,
    dbBanque, setDbBanque,
    // Excel
    excelRows, enriched, filteredExcel, excelStats,
    importExcel, clearExcel,
    filterName,  setFilterName,
    filterStatus,setFilterStatus,
    // Actions
    importing, importToDB, exportFromDB,
    // Tab
    activeTab, setActiveTab,
    loading: prodQuery.isFetching || testQuery.isFetching,
  };
}
