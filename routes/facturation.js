// routes/facturation.js
const express   = require('express');
const router    = express.Router();
const oracledb  = require('oracledb');
const { query } = require('../db/postgres');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ── Modèle économique ────────────────────────────────────
const TARIFS = {
  wallet: { commission:0.500, emetteur:0.270, acquereur:0.100, smt:0.130, operateur:0 },
  ussd  : { commission:0.600, emetteur:0.310, acquereur:0.085, smt:0.130, operateur:0.075 },
  ctp   : { commission:0.400, emetteur:0.170, acquereur:0.100, smt:0.130, operateur:0 },
};

// ── GET /api/facturation — liste des factures ────────────
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT f.*, u.nom, u.prenom
       FROM factures f LEFT JOIN users u ON f.created_by=u.id
       ORDER BY f.annee DESC, f.mois DESC`, []
    );
    res.json({ success:true, factures: r.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── POST /api/facturation/generer ───────────────────────
router.post('/generer', requireAuth, requireRole('admin'), async (req, res) => {
  const { mois, annee } = req.body;
  if (!mois || !annee) return res.status(400).json({ success:false, error:'mois et annee requis' });

  try {
    // Vérifier si facture déjà existante
    const existing = await query(
      'SELECT id FROM factures WHERE mois=$1 AND annee=$2', [mois, annee]
    );
    if (existing.rows.length) {
      return res.status(409).json({
        success:false, error:'Facture déjà générée pour ce mois',
        factureId: existing.rows[0].id
      });
    }

    // Dates du mois
    const dateD = `${annee}-${String(mois).padStart(2,'0')}-01`;
    const lastDay = new Date(annee, mois, 0).getDate();
    const dateF = `${annee}-${String(mois).padStart(2,'0')}-${lastDay}`;
    const moisNom = new Date(annee, mois-1, 1)
      .toLocaleDateString('fr-FR', { month:'long', year:'numeric' });

    // ── 1. Données Paysmart (SQL Server) ───────────────
    const psmPool = req.sqlPool;
    const moisPad = String(mois).padStart(2,'0');
    let walletByFsp = {}, ussdByFsp = {};

    if (psmPool) {
      // Wallet (Paiement Mobile, Etat=PAID)
      try {
        const rW = await psmPool.request().query(`
          SELECT [FSP], COUNT(*) AS nb
          FROM [switchdb].[dbo].[TO_QLIK_BI_new]
          WHERE [Facturier]='CNTE'
            AND [Etat]='PAID'
            AND [mode]='Paiement Mobile'
            AND [Date] LIKE '__/${moisPad}/${annee}'
          GROUP BY [FSP]
          ORDER BY nb DESC`);
        rW.recordset.forEach(r => { walletByFsp[r.FSP || 'Inconnu'] = r.nb; });
      } catch(e) { console.warn('[facturation] Wallet PSM:', e.message); }

      // USSD (canal USSD, Etat=PAID)
      try {
        const rU = await psmPool.request().query(`
          SELECT [FSP], COUNT(*) AS nb
          FROM [switchdb].[dbo].[TO_QLIK_BI_new]
          WHERE [Facturier]='CNTE'
            AND [Etat]='PAID'
            AND [Canal]='USSD'
            AND [Date] LIKE '__/${moisPad}/${annee}'
          GROUP BY [FSP]
          ORDER BY nb DESC`);
        rU.recordset.forEach(r => { ussdByFsp[r.FSP || 'Inconnu'] = r.nb; });
      } catch(e) { console.warn('[facturation] USSD PSM:', e.message); }
    }

    // ── 2. Données CTP (Oracle) ─────────────────────────
    let ctpTotal = 0;
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
      }
    } catch(e) { console.warn('[facturation] Oracle:', e.message); }

    // ── 3. Construire les lignes ─────────────────────────
    const lignes = [];

    // Wallet par FSP
    Object.entries(walletByFsp).forEach(([fsp, nb]) => {
      const t = TARIFS.wallet;
      lignes.push({
        canal:'wallet', fsp, nb_transactions: nb,
        ...t,
        montant_commission : +(nb * t.commission).toFixed(3),
        montant_emetteur   : +(nb * t.emetteur).toFixed(3),
        montant_acquereur  : +(nb * t.acquereur).toFixed(3),
        montant_smt        : +(nb * t.smt).toFixed(3),
        montant_operateur  : 0,
        montant_total      : +(nb * t.commission).toFixed(3),
      });
    });

    // USSD par FSP
    Object.entries(ussdByFsp).forEach(([fsp, nb]) => {
      const t = TARIFS.ussd;
      lignes.push({
        canal:'ussd', fsp, nb_transactions: nb,
        ...t,
        montant_commission : +(nb * t.commission).toFixed(3),
        montant_emetteur   : +(nb * t.emetteur).toFixed(3),
        montant_acquereur  : +(nb * t.acquereur).toFixed(3),
        montant_smt        : +(nb * t.smt).toFixed(3),
        montant_operateur  : +(nb * t.operateur).toFixed(3),
        montant_total      : +(nb * t.commission).toFixed(3),
      });
    });

    // CTP ligne unique
    if (ctpTotal > 0) {
      const t = TARIFS.ctp;
      lignes.push({
        canal:'ctp', fsp:'CLICTOPAY/CARTE', nb_transactions: ctpTotal,
        ...t,
        montant_commission : +(ctpTotal * t.commission).toFixed(3),
        montant_emetteur   : +(ctpTotal * t.emetteur).toFixed(3),
        montant_acquereur  : +(ctpTotal * t.acquereur).toFixed(3),
        montant_smt        : +(ctpTotal * t.smt).toFixed(3),
        montant_operateur  : 0,
        montant_total      : +(ctpTotal * t.commission).toFixed(3),
      });
    }

    // Total général
    const montantTotal = lignes.reduce((s,l) => s + l.montant_total, 0);

    // ── 4. Numéro de facture ─────────────────────────────
    const seqRes = await query("SELECT nextval('facture_seq') AS n", []);
    const numero = `FAC-${annee}-${String(seqRes.rows[0].n).padStart(4,'0')}`;

    // ── 5. Sauvegarder en base ───────────────────────────
    const facRes = await query(
      `INSERT INTO factures (numero, mois, annee, montant_total, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [numero, mois, annee, montantTotal.toFixed(3), req.user.id]
    );
    const factureId = facRes.rows[0].id;

    for (const l of lignes) {
      await query(
        `INSERT INTO facture_lignes
         (facture_id,canal,fsp,nb_transactions,commission,emetteur,acquereur,smt,operateur,
          montant_commission,montant_emetteur,montant_acquereur,montant_smt,montant_operateur,montant_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [factureId, l.canal, l.fsp, l.nb_transactions,
         l.commission, l.emetteur, l.acquereur, l.smt, l.operateur||0,
         l.montant_commission, l.montant_emetteur, l.montant_acquereur,
         l.montant_smt, l.montant_operateur||0, l.montant_total]
      );
    }

    await logAction(req, 'FACTURE_GENERER', `facture:${factureId}`, { numero, mois, annee });
    res.json({ success:true, factureId, numero, mois, annee, moisNom, lignes, montantTotal });

  } catch(e) {
    console.error('[facturation]', e.message);
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── GET /api/facturation/:id — détail d'une facture ─────
router.get('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const f = await query(
      `SELECT f.*, u.nom, u.prenom FROM factures f
       LEFT JOIN users u ON f.created_by=u.id WHERE f.id=$1`, [req.params.id]
    );
    if (!f.rows.length) return res.status(404).json({ success:false, error:'Facture introuvable' });
    const l = await query(
      `SELECT * FROM facture_lignes WHERE facture_id=$1
       ORDER BY canal, fsp`, [req.params.id]
    );
    res.json({ success:true, facture: f.rows[0], lignes: l.rows });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/facturation/:id/pdf ────────────────────────
router.get('/:id/pdf', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const f = await query(
      'SELECT * FROM factures WHERE id=$1', [req.params.id]
    );
    if (!f.rows.length) return res.status(404).json({ success:false, error:'Introuvable' });
    const l = await query(
      'SELECT * FROM facture_lignes WHERE facture_id=$1 ORDER BY canal,fsp',
      [req.params.id]
    );
    const data = { facture: f.rows[0], lignes: l.rows };
    const tmp  = `/tmp/facture_${req.params.id}.pdf`;
    execFileSync('python3', [
      '/app/scripts/gen_facture.py', tmp, JSON.stringify(data)
    ], { timeout: 60000 });
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    res.set({
      'Content-Type'       : 'application/pdf',
      'Content-Disposition': `attachment; filename="${f.rows[0].numero}.pdf"`,
    });
    res.send(buf);
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── GET /api/facturation/:id/excel ──────────────────────
router.get('/:id/excel', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const f = await query('SELECT * FROM factures WHERE id=$1', [req.params.id]);
    if (!f.rows.length) return res.status(404).json({ success:false });
    const facture = f.rows[0];
    const l = await query(
      'SELECT * FROM facture_lignes WHERE facture_id=$1 ORDER BY canal,fsp',
      [req.params.id]
    );
    const XLSX = require('xlsx');
    const moisNom = new Date(facture.annee, facture.mois-1, 1)
      .toLocaleDateString('fr-FR', { month:'long', year:'numeric' });

    const canalLabel = { wallet:'Wallet Mobile', ussd:'USSD / App Opérateur', ctp:'Web / Carte bancaire' };
    const rows = l.rows.map(lg => ({
      'Canal'                : canalLabel[lg.canal] || lg.canal,
      'Partenaire / FSP'     : lg.fsp,
      'Nb transactions'      : lg.nb_transactions,
      'Commission unit. (TND)': lg.commission,
      'Montant commission'   : lg.montant_commission,
      'Émetteur unit.'       : lg.emetteur,
      'Montant émetteur'     : lg.montant_emetteur,
      'Acquéreur unit.'      : lg.acquereur,
      'Montant acquéreur'    : lg.montant_acquereur,
      'SMT unit.'            : lg.smt,
      'Montant SMT'          : lg.montant_smt,
      ...(lg.canal === 'ussd' ? {
        'Opérateur unit.'    : lg.operateur,
        'Montant opérateur'  : lg.montant_operateur,
      } : {}),
      'Total ligne (TND)'    : lg.montant_total,
    }));

    // Ligne total
    rows.push({
      'Canal': 'TOTAL',
      'Partenaire / FSP': '',
      'Nb transactions': l.rows.reduce((s,r) => s+r.nb_transactions, 0),
      'Total ligne (TND)': facture.montant_total,
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Facture ${moisNom}`);
    const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
    res.set({
      'Content-Type'       : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${facture.numero}.xlsx"`,
    });
    res.send(buf);
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── DELETE /api/facturation/:id ─────────────────────────
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM facture_lignes WHERE facture_id=$1', [req.params.id]);
    await query('DELETE FROM factures WHERE id=$1', [req.params.id]);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

module.exports = router;
