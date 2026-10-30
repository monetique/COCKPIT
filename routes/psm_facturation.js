// routes/psm_facturation.js — Facturation Paysmart
'use strict';
const express   = require('express');
const router    = express.Router();
const oracledb  = require('oracledb');
const { query } = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { execFileSync } = require('child_process');
const fs = require('fs');

// ── Modèles économiques ──────────────────────────────────
const TARIF = {
  // Facturier standard
  facturier: {
    'Paiement Mobile': 0.800,
    'Carte'          : 0.800,
    'Virement'       : 0.360,
  },
  // Facturier CNTE (canal-dépendant, géré séparément)
  cnte_psm_wallet: 0.500,
  cnte_psm_ussd  : 0.600,
  cnte_ctp       : 0.400,
  // FSP
  fsp: {
    'Paiement Mobile': 0.400,
    'Carte'          : 0.400,
    'Virement'       : 0.000,
  },
  // SMT
  smt: {
    'Paiement Mobile': 0.300,
    'Carte'          : 0.300,
    'Virement'       : 0.260,
    'CTP'            : 0.300,
  },
  // We-Settle
  wesettle: {
    'Paiement Mobile': 0.100,
    'Carte'          : 0.100,
    'Virement'       : 0.086,
    'CTP'            : 0.100,
  },
  // Acquéreur
  acquereur: {
    'Paiement Mobile': 0.100,
    'Carte'          : 0.100,
    'Virement'       : 0.100,
    'CTP'            : 0.100,
  },
};

// Mapping acquéreur par facturier
function getAcquereur(facturier) {
  const f = (facturier||'').toUpperCase();
  if (f === 'STEG' || f === 'SONEDE') return 'STB';
  if (f === 'TOPNET') return 'BT';
  return 'BNA';
}

function ligne(facturier, canal, mode, nb, prix) {
  const ht = +(nb * prix).toFixed(3);
  return { facturier, canal, mode_paiement: mode, nb_transactions: nb,
           prix_unitaire_ht: prix, montant_ht: ht,
           tva_rate: 0, montant_tva: 0, montant_ttc: ht };
}

// ── Helpers données PSM ──────────────────────────────────
async function getPsmData(pool, mois, annee, facturier=null) {
  const moisPad = String(mois).padStart(2,'0');
  const datePat = `'__/${moisPad}/${annee}%'`;
  const facFilter = facturier ? `AND [Facturier]='${facturier.replace(/'/g,"''")}'` : '';

  const r = await pool.request().query(`
    SELECT [Facturier], [Canal], [mode], COUNT(*) AS nb
    FROM [switchdb].[dbo].[TO_QLIK_BI_new]
    WHERE [Etat]='PAID'
      AND [Date] LIKE ${datePat}
      ${facFilter}
    GROUP BY [Facturier],[Canal],[mode]
    ORDER BY [Facturier],[Canal],[mode]`);
  return r.recordset;
}

async function getCtpData(oPool, mois, annee) {
  const moisPad = String(mois).padStart(2,'0');
  const dateD   = `${annee}-${moisPad}-01`;
  const lastDay = new Date(annee, mois, 0).getDate();
  const dateF   = `${annee}-${moisPad}-${lastDay}`;
  const oConn = await oPool.getConnection();
  const r = await oConn.execute(
    `SELECT COUNT(*) AS NB FROM BPCTRANSACTIONS
     WHERE PROCESSING_ID='0383026168'
       AND TRIM(PAYMENT_STATE)='payment_deposited'
       AND TRUNC(TRANS_DATE) >= TO_DATE(:dd,'YYYY-MM-DD')
       AND TRUNC(TRANS_DATE) <= TO_DATE(:df,'YYYY-MM-DD')`,
    { dd: dateD, df: dateF },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  await oConn.close();
  return Number(r.rows[0]?.NB || 0);
}

async function saveFacture(type_dest, destinataire, mois, annee, lignes, userId, prefix) {
  const montantHt = lignes.reduce((s,l) => s + l.montant_ht, 0);
  const seq  = await query("SELECT nextval('psm_facture_seq') AS n", []);
  const num  = `${prefix}-${annee}-${String(seq.rows[0].n).padStart(4,'0')}`;
  const facRes = await query(
    `INSERT INTO psm_factures (numero,type_dest,destinataire,mois,annee,montant_ht,tva,montant_ttc,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,0,$6,$7) RETURNING id`,
    [num, type_dest, destinataire, mois, annee, montantHt.toFixed(3), userId]
  );
  const fid = facRes.rows[0].id;
  for (const l of lignes) {
    await query(
      `INSERT INTO psm_facture_lignes
       (facture_id,facturier,canal,mode_paiement,nb_transactions,
        prix_unitaire_ht,montant_ht,tva_rate,montant_tva,montant_ttc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [fid, l.facturier||null, l.canal||null, l.mode_paiement,
       l.nb_transactions, l.prix_unitaire_ht, l.montant_ht,
       l.tva_rate||0, l.montant_tva||0, l.montant_ttc||l.montant_ht]
    ).catch(()=>{});
  }
  return { factureId:fid, numero:num, montantHt };
}

// ── GET /api/psm-facturation — liste ────────────────────
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { type_dest, mois, annee } = req.query;
  try {
    let where = 'WHERE 1=1';
    const params = [];
    if (type_dest) { params.push(type_dest); where += ` AND type_dest=$${params.length}`; }
    if (mois)      { params.push(mois);      where += ` AND mois=$${params.length}`; }
    if (annee)     { params.push(annee);     where += ` AND annee=$${params.length}`; }
    const r = await query(
      `SELECT f.*, u.nom, u.prenom FROM psm_factures f
       LEFT JOIN users u ON f.created_by=u.id
       ${where} ORDER BY f.annee DESC, f.mois DESC, f.type_dest, f.destinataire`, params
    );
    res.json({ success:true, factures: r.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/psm-facturation/facturiers-list ─────────────
router.get('/facturiers-list', requireAuth, requireRole('admin'), async (req, res) => {
  const { mois, annee } = req.query;
  try {
    const pool = req.sqlPool;
    if (!pool) return res.json({ success:true, facturiers:[] });
    const moisPad = String(mois||new Date().getMonth()+1).padStart(2,'0');
    const yr = annee || new Date().getFullYear();
    const r = await pool.request().query(`
      SELECT DISTINCT [Facturier]
      FROM [switchdb].[dbo].[TO_QLIK_BI_new]
      WHERE [Etat]='PAID' AND [Date] LIKE '__/${moisPad}/${yr}%'
      ORDER BY [Facturier]`);
    res.json({ success:true, facturiers: r.recordset.map(r=>r.Facturier) });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/psm-facturation/fsp-list ────────────────────
router.get('/fsp-list', requireAuth, requireRole('admin'), async (req, res) => {
  const { mois, annee } = req.query;
  try {
    const pool = req.sqlPool;
    if (!pool) return res.json({ success:true, fsps:[] });
    const moisPad = String(mois||new Date().getMonth()+1).padStart(2,'0');
    const yr = annee || new Date().getFullYear();
    const r = await pool.request().query(`
      SELECT DISTINCT [FSP]
      FROM [switchdb].[dbo].[TO_QLIK_BI_new]
      WHERE [Etat]='PAID' AND [Date] LIKE '__/${moisPad}/${yr}%'
      ORDER BY [FSP]`);
    res.json({ success:true, fsps: r.recordset.map(r=>r.FSP).filter(Boolean) });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── POST /api/psm-facturation/generer ────────────────────
router.post('/generer', requireAuth, requireRole('admin'), async (req, res) => {
  const { type_dest, mois, annee, destinataire } = req.body;
  if (!type_dest || !mois || !annee)
    return res.status(400).json({ success:false, error:'type_dest, mois, annee requis' });

  const pool  = req.sqlPool;
  const oPool = req.oraclePool;
  const moisPad = String(mois).padStart(2,'0');
  const results = [];

  try {
    // ── 1. FACTURIER ─────────────────────────────────────
    if (type_dest === 'facturier') {
      const facturiers = destinataire ? [destinataire]
        : (await pool.request().query(`
            SELECT DISTINCT [Facturier] FROM [switchdb].[dbo].[TO_QLIK_BI_new]
            WHERE [Etat]='PAID' AND [Date] LIKE '__/${moisPad}/${annee}%'
            ORDER BY [Facturier]`)).recordset.map(r=>r.Facturier);

      for (const fac of facturiers) {
        const existing = await query(
          'SELECT id FROM psm_factures WHERE type_dest=$1 AND destinataire=$2 AND mois=$3 AND annee=$4',
          [type_dest, fac, mois, annee]
        );
        if (existing.rows.length) { results.push({ destinataire:fac, statut:'existe', factureId:existing.rows[0].id }); continue; }

        const lignes = [];
        const rows = await getPsmData(pool, mois, annee, fac);

        if (fac === 'CNTE') {
          // PSM wallet
          rows.filter(r => r.mode === 'Paiement Mobile').forEach(r => {
            const prix = (r.Canal||'').toUpperCase() === 'USSD'
              ? TARIF.cnte_psm_ussd : TARIF.cnte_psm_wallet;
            lignes.push(ligne(fac, r.Canal, r.mode, r.nb, prix));
          });
          // PSM carte
          rows.filter(r => r.mode === 'Carte').forEach(r => {
            lignes.push(ligne(fac, r.Canal, r.mode, r.nb, TARIF.cnte_ctp));
          });
          // PSM virement
          rows.filter(r => r.mode === 'Virement').forEach(r => {
            lignes.push(ligne(fac, r.Canal, r.mode, r.nb, TARIF.facturier['Virement']));
          });
          // CTP
          if (oPool) {
            try {
              const ctpNb = await getCtpData(oPool, mois, annee);
              if (ctpNb > 0) lignes.push(ligne(fac, 'WEB', 'CTP - Carte bancaire', ctpNb, TARIF.cnte_ctp));
            } catch(e) { console.warn('[psm-fac] CTP:', e.message); }
          }
        } else {
          rows.forEach(r => {
            const prix = TARIF.facturier[r.mode] ?? 0;
            if (prix > 0 || r.mode === 'Virement') lignes.push(ligne(fac, r.Canal, r.mode, r.nb, prix));
          });
        }

        if (!lignes.length) { results.push({ destinataire:fac, statut:'vide' }); continue; }
        const saved = await saveFacture(type_dest, fac, mois, annee, lignes, req.user.id, 'PSM-FAC');
        results.push({ destinataire:fac, statut:'ok', ...saved });
      }
    }

    // ── 2. FSP ───────────────────────────────────────────
    else if (type_dest === 'fsp') {
      const fsps = destinataire ? [destinataire]
        : (await pool.request().query(`
            SELECT DISTINCT [FSP] FROM [switchdb].[dbo].[TO_QLIK_BI_new]
            WHERE [Etat]='PAID' AND [Date] LIKE '__/${moisPad}/${annee}%' AND [FSP] IS NOT NULL
            ORDER BY [FSP]`)).recordset.map(r=>r.FSP);

      for (const fsp of fsps) {
        const existing = await query(
          'SELECT id FROM psm_factures WHERE type_dest=$1 AND destinataire=$2 AND mois=$3 AND annee=$4',
          [type_dest, fsp, mois, annee]
        );
        if (existing.rows.length) { results.push({ destinataire:fsp, statut:'existe', factureId:existing.rows[0].id }); continue; }

        const lignes = [];
        // PSM : regrouper par facturier × mode
        const r = await pool.request().query(`
          SELECT [Facturier],[mode], COUNT(*) AS nb
          FROM [switchdb].[dbo].[TO_QLIK_BI_new]
          WHERE [Etat]='PAID' AND [FSP]='${fsp.replace(/'/g,"''")}' AND [Date] LIKE '__/${moisPad}/${annee}%'
          GROUP BY [Facturier],[mode] ORDER BY [Facturier],[mode]`);

        r.recordset.forEach(row => {
          const prix = TARIF.fsp[row.mode] ?? 0;
          lignes.push(ligne(row.Facturier, 'PSM', row.mode, row.nb, prix));
        });

        // CTP pour CNTE via ce FSP (si fsp = CNTE → renommer Paysmart_SDK)
        if (fsp === 'CNTE' && oPool) {
          try {
            const ctpNb = await getCtpData(oPool, mois, annee);
            if (ctpNb > 0) lignes.push(ligne('CNTE', 'WEB', 'CTP - Carte bancaire', ctpNb, TARIF.fsp['Carte']));
          } catch(e) { console.warn('[psm-fac] FSP CTP:', e.message); }
        }

        if (!lignes.length) { results.push({ destinataire:fsp, statut:'vide' }); continue; }
        const dest = fsp === 'CNTE' ? 'Paysmart_SDK' : fsp;
        const saved = await saveFacture(type_dest, dest, mois, annee, lignes, req.user.id, 'PSM-FSP');
        results.push({ destinataire:dest, statut:'ok', ...saved });
      }
    }

    // ── 3. SMT / WE-SETTLE / ACQUÉREUR ───────────────────
    else if (['smt','wesettle','acquereur'].includes(type_dest)) {
      const existing = await query(
        'SELECT id FROM psm_factures WHERE type_dest=$1 AND mois=$2 AND annee=$3',
        [type_dest, mois, annee]
      );
      if (existing.rows.length)
        return res.status(409).json({ success:false, error:'Facture déjà générée', factureId:existing.rows[0].id });

      const tarif = TARIF[type_dest];
      const lignes = [];

      // PSM global par mode (tous facturiers)
      const rows = await getPsmData(pool, mois, annee);

      // Regrouper par mode pour les facturiers non-CNTE
      const modeMap = {};
      rows.filter(r => r.Facturier !== 'CNTE').forEach(r => {
        modeMap[r.mode] = (modeMap[r.mode]||0) + r.nb;
      });

      // CNTE PSM selon canal
      const cnteRows = rows.filter(r => r.Facturier === 'CNTE');
      const cntePsmWallet = cnteRows.filter(r => r.mode === 'Paiement Mobile' && (r.Canal||'').toUpperCase() !== 'USSD').reduce((s,r)=>s+r.nb,0);
      const cntePsmUssd   = cnteRows.filter(r => (r.Canal||'').toUpperCase() === 'USSD').reduce((s,r)=>s+r.nb,0);
      const cntePsmCarte  = cnteRows.filter(r => r.mode === 'Carte').reduce((s,r)=>s+r.nb,0);
      const cntePsmVir    = cnteRows.filter(r => r.mode === 'Virement').reduce((s,r)=>s+r.nb,0);

      // CTP CNTE
      let ctpNb = 0;
      if (oPool) {
        try { ctpNb = await getCtpData(oPool, mois, annee); } catch(e) {}
      }

      // Lignes modes standards (hors CNTE)
      Object.entries(modeMap).forEach(([mode, nb]) => {
        if (nb > 0) lignes.push(ligne(null, 'PSM', mode, nb, tarif[mode]??0));
      });

      // Lignes CNTE avec prix canal-spécifique
      // Pour SMT/We-Settle/Acquéreur : utiliser les tarifs CNTE des inscriptions
      const tarifCnte = {
        wallet : type_dest === 'smt' ? 0.130 : type_dest === 'wesettle' ? 0.100/3 : 0.100,
        ussd   : type_dest === 'smt' ? 0.130 : type_dest === 'wesettle' ? 0.100/3 : 0.085,
        ctp    : type_dest === 'smt' ? 0.130 : type_dest === 'wesettle' ? 0.100/3 : 0.100,
        vir    : type_dest === 'smt' ? 0.260 : type_dest === 'wesettle' ? 0.086   : 0.100,
      };

      if (cntePsmWallet > 0) lignes.push(ligne('CNTE', 'PSM-Wallet', 'Paiement Mobile', cntePsmWallet, tarifCnte.wallet));
      if (cntePsmUssd   > 0) lignes.push(ligne('CNTE', 'PSM-USSD',   'Paiement Mobile USSD', cntePsmUssd, tarifCnte.ussd));
      if (cntePsmCarte  > 0) lignes.push(ligne('CNTE', 'PSM-Carte',  'Carte', cntePsmCarte, tarifCnte.ctp));
      if (cntePsmVir    > 0) lignes.push(ligne('CNTE', 'PSM',        'Virement', cntePsmVir, tarifCnte.vir));
      if (ctpNb         > 0) lignes.push(ligne('CNTE', 'CTP',        'Carte bancaire CTP', ctpNb, tarifCnte.ctp));

      const prefixes = { smt:'PSM-SMT', wesettle:'PSM-WS', acquereur:'PSM-ACQ' };
      const labels   = { smt:'SMT', wesettle:'We-Settle', acquereur:null };

      const saved = await saveFacture(
        type_dest, labels[type_dest] || type_dest,
        mois, annee, lignes, req.user.id, prefixes[type_dest]
      );
      results.push({ destinataire: labels[type_dest]||type_dest, statut:'ok', ...saved });
    }

    await logAction(req, 'PSM_FACTURE_GENERER', 'psm-facturation', { type_dest, mois, annee, nb:results.length });
    res.json({ success:true, results });

  } catch(e) {
    console.error('[psm-fac]', e.message);
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── GET /api/psm-facturation/:id ─────────────────────────
router.get('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const f = await query('SELECT * FROM psm_factures WHERE id=$1', [req.params.id]);
    if (!f.rows.length) return res.status(404).json({ success:false });
    const l = await query(
      'SELECT * FROM psm_facture_lignes WHERE facture_id=$1 ORDER BY facturier, canal, mode_paiement',
      [req.params.id]
    );
    res.json({ success:true, facture:f.rows[0], lignes:l.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/psm-facturation/:id/pdf ─────────────────────
router.get('/:id/pdf', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const f = await query('SELECT * FROM psm_factures WHERE id=$1', [req.params.id]);
    if (!f.rows.length) return res.status(404).json({ success:false });
    const l = await query(
      'SELECT * FROM psm_facture_lignes WHERE facture_id=$1 ORDER BY facturier,canal,mode_paiement',
      [req.params.id]
    );
    const tmp = `/tmp/psm_fac_${req.params.id}.pdf`;
    execFileSync('python3', ['/app/scripts/gen_psm_facture.py', tmp,
      JSON.stringify({ facture:f.rows[0], lignes:l.rows })], { timeout:60000 });
    const buf = fs.readFileSync(tmp); fs.unlinkSync(tmp);
    res.set({ 'Content-Type':'application/pdf',
              'Content-Disposition':`attachment; filename="${f.rows[0].numero}.pdf"` });
    res.send(buf);
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/psm-facturation/:id/excel ───────────────────
router.get('/:id/excel', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const f = await query('SELECT * FROM psm_factures WHERE id=$1', [req.params.id]);
    if (!f.rows.length) return res.status(404).json({ success:false });
    const l = await query(
      'SELECT * FROM psm_facture_lignes WHERE facture_id=$1 ORDER BY facturier,canal,mode_paiement',
      [req.params.id]
    );
    const XLSX = require('xlsx');
    const rows = l.rows.map(lg => ({
      'Facturier'         : lg.facturier || '—',
      'Canal'             : lg.canal     || '—',
      'Mode de paiement'  : lg.mode_paiement,
      'Nb transactions'   : lg.nb_transactions,
      'Prix unit. HT (TND)': lg.prix_unitaire_ht,
      'Montant HT (TND)'  : lg.montant_ht,
      'TVA (%)'           : lg.tva_rate,
      'Montant TVA (TND)' : lg.montant_tva,
      'Montant TTC (TND)' : lg.montant_ttc,
    }));
    rows.push({ 'Facturier':'TOTAL', 'Montant HT (TND)': f.rows[0].montant_ht,
                'Montant TTC (TND)': f.rows[0].montant_ttc });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, f.rows[0].numero);
    const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
    res.set({ 'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Disposition':`attachment; filename="${f.rows[0].numero}.xlsx"` });
    res.send(buf);
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── DELETE /api/psm-facturation/:id ──────────────────────
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM psm_facture_lignes WHERE facture_id=$1', [req.params.id]);
    await query('DELETE FROM psm_factures WHERE id=$1', [req.params.id]);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

module.exports = router;
