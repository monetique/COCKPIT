// routes/facturation_globale.js
const express   = require('express');
const router    = express.Router();
const oracledb  = require('oracledb');
const { query } = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { execFileSync } = require('child_process');
const fs   = require('fs');

// ── Modèle économique ────────────────────────────────────
const TARIFS = {
  web    : { commission:0.400, emetteur:0.170, acquereur:0.100, smt:0.130, operateur:0 },
  wallet : { commission:0.500, emetteur:0.270, acquereur:0.100, smt:0.130, operateur:0 },
  ussd   : { commission:0.600, emetteur:0.310, acquereur:0.085, smt:0.130, operateur:0.075 },
};

// Mapping canal × moyen → tarif
function getTarif(canal, moyen) {
  canal = (canal||'').toLowerCase();
  moyen = (moyen||'').toLowerCase();
  if (canal === 'ussd') return { key:'ussd', ...TARIFS.ussd };
  if (moyen === 'wallet' || moyen === 'paiement mobile') return { key:'wallet', ...TARIFS.wallet };
  return { key:'web', ...TARIFS.web }; // carte, virement, web
}

function calcLigne(nb, tarif) {
  return {
    nb_transactions    : nb,
    commission         : tarif.commission,
    emetteur           : tarif.emetteur,
    acquereur          : tarif.acquereur,
    smt                : tarif.smt,
    operateur          : tarif.operateur || 0,
    montant_commission : +(nb * tarif.commission).toFixed(3),
    montant_emetteur   : +(nb * tarif.emetteur).toFixed(3),
    montant_acquereur  : +(nb * tarif.acquereur).toFixed(3),
    montant_smt        : +(nb * tarif.smt).toFixed(3),
    montant_operateur  : +(nb * (tarif.operateur||0)).toFixed(3),
    montant_total      : +(nb * tarif.commission).toFixed(3),
  };
}

// ── GET /api/facturation-globale ─────────────────────────
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT f.*, u.nom, u.prenom
       FROM factures_globales f LEFT JOIN users u ON f.created_by=u.id
       ORDER BY f.annee DESC, f.mois DESC`, []
    );
    res.json({ success:true, factures: r.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── POST /api/facturation-globale/generer ────────────────
router.post('/generer', requireAuth, requireRole('admin'), async (req, res) => {
  const { mois, annee } = req.body;
  if (!mois || !annee) return res.status(400).json({ success:false, error:'mois et annee requis' });

  try {
    const existing = await query(
      'SELECT id FROM factures_globales WHERE mois=$1 AND annee=$2', [mois, annee]
    );
    if (existing.rows.length) return res.status(409).json({
      success:false, error:'Facture déjà générée', factureId: existing.rows[0].id
    });

    const moisPad = String(mois).padStart(2,'0');
    const dateD   = `${annee}-${moisPad}-01`;
    const lastDay = new Date(annee, mois, 0).getDate();
    const dateF   = `${annee}-${moisPad}-${lastDay}`;

    // ── 1. CTP Oracle — total cartes approuvées ──────────
    let ctpTotal = 0, psmCarteViaCtp = 0;
    try {
      const oPool = req.oraclePool;
      if (oPool) {
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
        ctpTotal = Number(r.rows[0]?.NB || 0);
        console.log(`[fac-globale] CTP total: ${ctpTotal}`);
      }
    } catch(e) { console.warn('[fac-globale] Oracle:', e.message); }

    // ── 2. Paysmart — répartition canal × moyen ──────────
    const psmLines = [];
    try {
      const pool = req.sqlPool;
      if (pool) {
        // Cartes via Paysmart (pour déduire du CTP)
        const rCarte = await pool.request().query(`
          SELECT [Canal], COUNT(*) AS nb
          FROM [switchdb].[dbo].[TO_QLIK_BI_new]
          WHERE [Facturier]='CNTE' AND [Etat]='PAID'
            AND [mode]='Carte'
            AND [Date] LIKE '__/${moisPad}/${annee}%'
          GROUP BY [Canal]`);
        rCarte.recordset.forEach(r => {
          psmCarteViaCtp += r.nb;
          const canal = (r.Canal||'web').toUpperCase();
          const tarif = getTarif(r.Canal, 'carte');
          psmLines.push({
            rubrique:'psm', canal: r.Canal||'WEB', moyen:'Carte',
            label: `Paysmart — Carte / ${canal}`,
            tarif_canal: tarif.key,
            ...calcLigne(r.nb, tarif),
          });
        });

        // Wallets
        const rWallet = await pool.request().query(`
          SELECT [Canal], COUNT(*) AS nb
          FROM [switchdb].[dbo].[TO_QLIK_BI_new]
          WHERE [Facturier]='CNTE' AND [Etat]='PAID'
            AND [mode]='Paiement Mobile'
            AND [Date] LIKE '__/${moisPad}/${annee}%'
          GROUP BY [Canal]`);
        rWallet.recordset.forEach(r => {
          const canal = (r.Canal||'web').toUpperCase();
          const tarif = getTarif(r.Canal, 'wallet');
          psmLines.push({
            rubrique:'psm', canal: r.Canal||'WEB', moyen:'Wallet',
            label: `Paysmart — Portefeuille mobile / ${canal}`,
            tarif_canal: tarif.key,
            ...calcLigne(r.nb, tarif),
          });
        });

        // Virement
        const rVir = await pool.request().query(`
          SELECT COUNT(*) AS nb
          FROM [switchdb].[dbo].[TO_QLIK_BI_new]
          WHERE [Facturier]='CNTE' AND [Etat]='PAID'
            AND [mode]='Virement'
            AND [Date] LIKE '__/${moisPad}/${annee}%'`);
        const nbVir = rVir.recordset[0]?.nb || 0;
        if (nbVir > 0) {
          const tarif = getTarif('web', 'virement');
          psmLines.push({
            rubrique:'psm', canal:'WEB', moyen:'Virement',
            label: 'Paysmart — Virement',
            tarif_canal: tarif.key,
            ...calcLigne(nbVir, tarif),
          });
        }
        console.log(`[fac-globale] PSM lignes: ${psmLines.length}, cartes via PSM: ${psmCarteViaCtp}`);
      }
    } catch(e) { console.warn('[fac-globale] Paysmart:', e.message); }

    // ── 3. CTP direct = CTP total - cartes via Paysmart ──
    const ctpDirect = Math.max(0, ctpTotal - psmCarteViaCtp);
    const tarif_ctp = getTarif('web', 'carte');
    const ctpLine = {
      rubrique:'ctp', canal:'WEB', moyen:'Carte',
      label: 'ClicToPay direct — Cartes bancaires',
      tarif_canal: 'web',
      ...calcLigne(ctpDirect, tarif_ctp),
    };

    const allLines   = [ctpLine, ...psmLines];
    const montantTotal = allLines.reduce((s,l) => s + l.montant_total, 0);

    // ── 4. Sauvegarder ───────────────────────────────────
    const seqRes = await query("SELECT nextval('facture_globale_seq') AS n", []);
    const numero = `FAG-${annee}-${String(seqRes.rows[0].n).padStart(4,'0')}`;

    const facRes = await query(
      `INSERT INTO factures_globales (numero, mois, annee, montant_total, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [numero, mois, annee, montantTotal.toFixed(3), req.user.id]
    );
    const factureId = facRes.rows[0].id;

    for (const l of allLines) {
      await query(
        `INSERT INTO facture_globale_lignes
         (facture_id,rubrique,canal,moyen,label,tarif_canal,nb_transactions,
          commission,emetteur,acquereur,smt,operateur,
          montant_commission,montant_emetteur,montant_acquereur,
          montant_smt,montant_operateur,montant_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [factureId, l.rubrique, l.canal, l.moyen, l.label, l.tarif_canal,
         l.nb_transactions, l.commission, l.emetteur, l.acquereur, l.smt, l.operateur||0,
         l.montant_commission, l.montant_emetteur, l.montant_acquereur,
         l.montant_smt, l.montant_operateur||0, l.montant_total]
      );
    }

    await logAction(req, 'FAC_GLOBALE_GENERER', `facture:${factureId}`, { numero, mois, annee });
    res.json({ success:true, factureId, numero, mois, annee, lignes: allLines, montantTotal });

  } catch(e) {
    console.error('[fac-globale]', e.message);
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── GET /api/facturation-globale/:id ─────────────────────
router.get('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const f = await query(
      `SELECT f.*, u.nom, u.prenom FROM factures_globales f
       LEFT JOIN users u ON f.created_by=u.id WHERE f.id=$1`, [req.params.id]
    );
    if (!f.rows.length) return res.status(404).json({ success:false });
    const l = await query(
      `SELECT * FROM facture_globale_lignes WHERE facture_id=$1
       ORDER BY rubrique, canal, moyen`, [req.params.id]
    );
    res.json({ success:true, facture: f.rows[0], lignes: l.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/facturation-globale/:id/pdf ─────────────────
router.get('/:id/pdf', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const f = await query('SELECT * FROM factures_globales WHERE id=$1', [req.params.id]);
    if (!f.rows.length) return res.status(404).json({ success:false });
    const l = await query(
      'SELECT * FROM facture_globale_lignes WHERE facture_id=$1 ORDER BY rubrique,canal,moyen',
      [req.params.id]
    );
    const tmp = `/tmp/fac_glob_${req.params.id}.pdf`;
    execFileSync('python3', ['/app/scripts/gen_facture_globale.py', tmp,
      JSON.stringify({ facture: f.rows[0], lignes: l.rows })], { timeout:60000 });
    const buf = fs.readFileSync(tmp); fs.unlinkSync(tmp);
    res.set({ 'Content-Type':'application/pdf',
              'Content-Disposition':`attachment; filename="${f.rows[0].numero}.pdf"` });
    res.send(buf);
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/facturation-globale/:id/excel ───────────────
router.get('/:id/excel', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const f = await query('SELECT * FROM factures_globales WHERE id=$1', [req.params.id]);
    if (!f.rows.length) return res.status(404).json({ success:false });
    const l = await query(
      'SELECT * FROM facture_globale_lignes WHERE facture_id=$1 ORDER BY rubrique,canal,moyen',
      [req.params.id]
    );
    const XLSX = require('xlsx');
    const rows = l.rows.map(lg => ({
      'Rubrique'             : lg.rubrique === 'ctp' ? 'CTP Direct' : 'Paysmart',
      'Libellé'              : lg.label,
      'Canal'                : lg.canal,
      'Moyen'                : lg.moyen,
      'Nb transactions'      : lg.nb_transactions,
      'Commission unit. (TND)': lg.commission,
      'Montant commission'   : lg.montant_commission,
      'Émetteur unit.'       : lg.emetteur,
      'Montant émetteur'     : lg.montant_emetteur,
      'Acquéreur unit.'      : lg.acquereur,
      'Montant acquéreur'    : lg.montant_acquereur,
      'SMT unit.'            : lg.smt,
      'Montant SMT'          : lg.montant_smt,
      ...(parseFloat(lg.operateur||0) > 0 ? {
        'Opérateur unit.'    : lg.operateur,
        'Montant opérateur'  : lg.montant_operateur,
      } : {}),
      'Total ligne (TND)'    : lg.montant_total,
    }));
    rows.push({ 'Rubrique':'TOTAL', 'Total ligne (TND)': f.rows[0].montant_total });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Facture globale');
    const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
    res.set({ 'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Disposition':`attachment; filename="${f.rows[0].numero}.xlsx"` });
    res.send(buf);
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── DELETE /api/facturation-globale/:id ──────────────────
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM facture_globale_lignes WHERE facture_id=$1', [req.params.id]);
    await query('DELETE FROM factures_globales WHERE id=$1', [req.params.id]);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

module.exports = router;
