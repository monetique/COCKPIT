// routes/inscriptions.js — Module Inscriptions Scolaires
// Source 1 : Oracle BPC (BPCTRANSACTIONS) — PROCESSING_ID = '0383026168'
// Source 2 : SQL Server PAYSMART (switchdb.TO_QLIK_BI_new) — Facturier = 'CNTE'
'use strict';
const express   = require('express');
const router    = express.Router();
const oracledb  = require('oracledb');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── Helpers ───────────────────────────────────────────────
const TIMEOUT_CODES  = ['-2007','-2013','341022','341023'];
const AUTH3DS_CODES  = ['-2006','341018','341024','341025'];

function categorizeReason(reason) {
  if (!reason) return 'banque';
  const r = String(reason);
  for (const c of TIMEOUT_CODES)  if (r.includes(c)) return 'timeout';
  for (const c of AUTH3DS_CODES)  if (r.includes(c)) return 'auth3ds';
  return 'banque';
}

function mapCtpState(state) {
  if (!state) return 'pending';
  const s = String(state).toLowerCase();
  if (s.includes('deposited') || s.includes('approved')) return 'ok';
  if (s.includes('declined') || s.includes('failed'))    return 'fail';
  return 'pending';
}

function mapPsmState(state) {
  if (!state) return 'pending';
  const s = String(state);
  if (s === 'PAID' || s === 'Payée') return 'ok';
  return 'pending';
}

function groupByHour(rows, tsField, threshold = 72) {
  // Si plage > 72h → grouper par jour, sinon par heure
  if (!rows.length) return { buckets: [], byDay: false };
  const ts = rows.map(r => new Date(r[tsField]).getTime()).filter(Boolean);
  const span = (Math.max(...ts) - Math.min(...ts)) / 3600000;
  const byDay = span > threshold;

  const map = {};
  for (const r of rows) {
    const d = new Date(r[tsField]);
    if (isNaN(d)) continue;
    const key = byDay
      ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}h`;
    if (!map[key]) map[key] = { label: key, ctp: 0, psm: 0 };
    if (r._src === 'ctp') map[key].ctp++;
    else                  map[key].psm++;
  }
  const buckets = Object.values(map).sort((a,b) => a.label.localeCompare(b.label));
  return { buckets, byDay };
}

function detectLaunch(buckets) {
  const total = buckets.reduce((s,b) => s + b.ctp + b.psm, 0);
  const threshold = Math.max(20, total * 0.03);
  for (const b of buckets) {
    if ((b.ctp + b.psm) >= threshold) return b.label;
  }
  return buckets[0]?.label || null;
}

// ── POST /api/inscriptions/stats ──────────────────────────
router.post('/stats', requireAuth, requireRole('admin'), async (req, res) => {
  const { date_debut, date_fin } = req.body;
  const dd = date_debut || '20/08/2026';
  const df = date_fin   || new Date().toLocaleDateString('fr-FR');

  try {
    // ── 1. ClicToPay (Oracle) — agrégations SQL ────────
    const oConn = await oracledb.getConnection('bpc');
    let ctpKpis = { total:0, ok:0, fail:0, amount:0 };
    let ctpByHour = [], ctpNetworks = [], ctpFailReasons = {};
    let ctpFailByCategory = { timeout:0, auth3ds:0, banque:0 };

    try {
      // KPIs globaux
      const rKpi = await oConn.execute(`
        SELECT COUNT(*) AS TOTAL,
          SUM(CASE WHEN TRIM(PAYMENT_STATE)='payment_deposited' THEN 1 ELSE 0 END) AS OK,
          SUM(CASE WHEN TRIM(PAYMENT_STATE)='payment_declined'  THEN 1 ELSE 0 END) AS FAIL,
          NVL(SUM(CASE WHEN TRIM(PAYMENT_STATE)='payment_deposited' THEN AMOUNT ELSE 0 END),0) AS AMOUNT
        FROM BPCTRANSACTIONS T
        WHERE T.PROCESSING_ID = :pid
          AND T.TRANS_DATE >= TO_DATE(:dd,'DD/MM/YYYY')
          AND T.TRANS_DATE <= TO_DATE(:df,'DD/MM/YYYY')+1-1/86400`,
        { pid:'0383026168', dd, df }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const k = rKpi.rows[0];
      ctpKpis = { total: Number(k.TOTAL), ok: Number(k.OK), fail: Number(k.FAIL), amount: Number(k.AMOUNT)/1000 };

      // Timeline par heure
      const rHour = await oConn.execute(`
        SELECT TO_CHAR(T.TRANS_DATE,'HH24') AS HEURE,
          COUNT(*) AS TOTAL,
          SUM(CASE WHEN TRIM(PAYMENT_STATE)='payment_deposited' THEN 1 ELSE 0 END) AS OK
        FROM BPCTRANSACTIONS T
        WHERE T.PROCESSING_ID = :pid
          AND T.TRANS_DATE >= TO_DATE(:dd,'DD/MM/YYYY')
          AND T.TRANS_DATE <= TO_DATE(:df,'DD/MM/YYYY')+1-1/86400
        GROUP BY TO_CHAR(T.TRANS_DATE,'HH24')
        ORDER BY HEURE`,
        { pid:'0383026168', dd, df }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      ctpByHour = rHour.rows.map(r => ({ label: r.HEURE+'h', ctp: Number(r.OK), psm: 0 }));

      // Réseaux (PAYMENT_SYSTEM)
      const rNet = await oConn.execute(`
        SELECT NVL(PAYMENT_SYSTEM,'Inconnu') AS NET, COUNT(*) AS CNT
        FROM BPCTRANSACTIONS T
        WHERE T.PROCESSING_ID = :pid
          AND T.TRANS_DATE >= TO_DATE(:dd,'DD/MM/YYYY')
          AND T.TRANS_DATE <= TO_DATE(:df,'DD/MM/YYYY')+1-1/86400
          AND TRIM(PAYMENT_STATE)='payment_deposited'
        GROUP BY PAYMENT_SYSTEM ORDER BY CNT DESC FETCH FIRST 10 ROWS ONLY`,
        { pid:'0383026168', dd, df }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      ctpNetworks = rNet.rows.map(r => ({ name: r.NET, count: Number(r.CNT) }));

      // Motifs échec (ACTION_CODE_INT)
      const rFail = await oConn.execute(`
        SELECT ACTION_CODE_INT AS CODE, COUNT(*) AS CNT
        FROM BPCTRANSACTIONS T
        WHERE T.PROCESSING_ID = :pid
          AND T.TRANS_DATE >= TO_DATE(:dd,'DD/MM/YYYY')
          AND T.TRANS_DATE <= TO_DATE(:df,'DD/MM/YYYY')+1-1/86400
          AND TRIM(PAYMENT_STATE)='payment_declined'
          AND ACTION_CODE_INT IS NOT NULL
        GROUP BY ACTION_CODE_INT ORDER BY CNT DESC FETCH FIRST 10 ROWS ONLY`,
        { pid:'0383026168', dd, df }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      rFail.rows.forEach(r => {
        const code = Number(r.CODE);
        const cnt  = Number(r.CNT);
        ctpFailReasons[code] = cnt;
        if (code === -2007 || code === 100827) ctpFailByCategory.timeout += cnt;
        else if (code === 116)                 ctpFailByCategory.auth3ds += cnt;
        else                                   ctpFailByCategory.banque  += cnt;
      });
    } finally { await oConn.close(); }

    // ── 2. Paysmart (SQL Server) ───────────────────────
    let psmRows = [];
    const pool = req.sqlPool;
    if (pool) {
      try {
        const toSqlDate = (s) => { const [d,m,y] = s.split('/'); return `${y}-${m}-${d}`; };
        const r = await pool.request().query(`
          SELECT [Date],[Heure],[Etat],[Montant],[FSP],[Canal],[Moyen],[mode],[reference]
          FROM [switchdb].[dbo].[TO_QLIK_BI_new]
          WHERE [Facturier] = 'CNTE'
            AND CONVERT(date,[Date],103) >= CONVERT(date,'${toSqlDate(dd)}',23)
            AND CONVERT(date,[Date],103) <= CONVERT(date,'${toSqlDate(df)}',23)`);
        psmRows = (r.recordset || []).map(row => ({
          state    : mapPsmState(row.Etat),
          amount   : row.Montant ? Number(row.Montant)/1000 : null,
          network  : row.FSP   || null,
          moyen    : row.Moyen || null,
          mode     : row.mode  || null,
          canal    : row.Canal || null,
          heure    : (row.Heure||'00').slice(0,2),
          date_str : row.Date  ? String(row.Date).slice(0,10) : null,
        }));
      } catch(e) { console.warn('[inscriptions] Paysmart:', e.message); }
    }

    // ── 3. Agrégations Paysmart ────────────────────────
    const psmOkRows      = psmRows.filter(r => r.state === 'ok');
    const psmWalletOk    = psmOkRows.filter(r => r.mode === 'Paiement Mobile' || /^Wallet|Flouci/i.test(r.moyen||''));
    const psmCarteOk     = psmOkRows.filter(r => r.mode === 'Carte'           || /^Carte/i.test(r.moyen||''));
    const psmVirementOk  = psmOkRows.filter(r => r.mode === 'Virement'        || /^Virement/i.test(r.moyen||''));

    const psmMoyen = {}, psmMode = {}, psmCanal = {}, psmFsp = {};
    let psmCarte = 0, psmWallet = 0, psmVirement = 0;
    psmOkRows.forEach(r => {
      if (r.moyen)   psmMoyen[r.moyen]   = (psmMoyen[r.moyen]   || 0) + 1;
      if (r.mode)    psmMode [r.mode]     = (psmMode [r.mode]    || 0) + 1;
      if (r.network) psmFsp  [r.network]  = (psmFsp  [r.network] || 0) + 1;
      const c = r.canal || 'Non renseigné';
      psmCanal[c] = (psmCanal[c] || 0) + 1;
      if      (r.mode === 'Carte'           || /^Carte/i.test(r.moyen||''))          psmCarte++;
      else if (r.mode === 'Paiement Mobile' || /^Wallet|Flouci/i.test(r.moyen||'')) psmWallet++;
      else if (r.mode === 'Virement'        || /^Virement/i.test(r.moyen||''))       psmVirement++;
    });

    // Canaux Paysmart (tous états)
    const webCount  = psmRows.filter(r => r.canal === 'WEB').length;
    const mobCount  = psmRows.filter(r => r.canal === 'MOBILE').length;
    const ussdCount = psmRows.filter(r => r.canal === 'USSD').length;

    // ── 4. KPIs globaux ───────────────────────────────
    // enrolled = cartes CTP (inclut cartes PSM) + wallets PSM + virements PSM
    const ctpEnrolled  = ctpKpis.ok;
    const psmEnrolled  = psmWalletOk.length + psmVirementOk.length;
    const psmCarteVia  = psmCarteOk.length;
    const enrolled     = ctpEnrolled + psmEnrolled;
    const total        = ctpKpis.total + psmRows.length;
    const amount       = ctpKpis.amount;
    const timeoutCount = ctpFailByCategory.timeout;
    const successRate  = total > 0 ? Math.round(enrolled/total*1000)/10 : 0;
    const adjustedRate = (total-timeoutCount) > 0 ? Math.round(enrolled/(total-timeoutCount)*100) : successRate;

    // ── 5. Timeline fusionnée par jour/heure ──────────
    const span = (() => {
      const dd_d = new Date(dd.split('/').reverse().join('-'));
      const df_d = new Date(df.split('/').reverse().join('-'));
      return (df_d - dd_d) / (1000*3600);
    })();
    const byDay = span > 20; // > 20h → grouper par jour

    const timeMap = {};

    if (!byDay) {
      // Mode horaire : CTP par heure (buckets Oracle)
      ctpByHour.forEach(b => {
        const key = b.label.padStart(2,'0') + 'h';
        if (!timeMap[key]) timeMap[key] = { label: key, ctp: 0, psm: 0 };
        timeMap[key].ctp += b.ctp;
      });
      // PSM par heure
      psmRows.forEach(r => {
        if (r.state !== 'ok') return;
        const key = (r.heure||'00').padStart(2,'0') + 'h';
        if (!timeMap[key]) timeMap[key] = { label: key, ctp: 0, psm: 0 };
        timeMap[key].psm++;
      });
    }

    // Reconstruire CTP par date depuis psmRows (on a les dates PSM)
    // Mieux : refaire CTP par date via une requête agrégée
    // Pour l'instant on reconstruit la timeline depuis les données PSM disponibles
    // et on complète avec CTP par heure

    // Mode journalier : requête Oracle dédiée + PSM par date SQL Server
    if (byDay) {
      // PSM par date (Date est une colonne SQL Server au format DD/MM/YYYY)
      psmRows.forEach(r => {
        if (r.state !== 'ok') return;
        // r.date_str = "24/08/2026" ou r.ts = Date object
        let key;
        if (r.date_str) {
          const parts = r.date_str.split('/');
          key = `${parts[0]}/${parts[1]}`; // DD/MM
        } else {
          const d = r.ts instanceof Date ? r.ts : new Date(r.ts);
          if (isNaN(d.getTime())) return;
          key = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
        }
        if (!timeMap[key]) timeMap[key] = { label: key, ctp: 0, psm: 0 };
        timeMap[key].psm++;
      });

      // CTP par jour via requête Oracle
      try {
        const oConn2 = await oracledb.getConnection('bpc');
        const rDay = await oConn2.execute(`
          SELECT TRUNC(T.TRANS_DATE) AS JOUR,
                 SUM(CASE WHEN TRIM(PAYMENT_STATE)='payment_deposited' THEN 1 ELSE 0 END) AS OK
          FROM BPCTRANSACTIONS T
          WHERE T.PROCESSING_ID = :pid
            AND T.TRANS_DATE >= TO_DATE(:dd,'DD/MM/YYYY')
            AND T.TRANS_DATE <= TO_DATE(:df,'DD/MM/YYYY')+1-1/86400
          GROUP BY TRUNC(T.TRANS_DATE)
          ORDER BY JOUR`,
          { pid:'0383026168', dd, df },
          { outFormat: oracledb.OUT_FORMAT_OBJECT });
        await oConn2.close();
        rDay.rows.forEach(r => {
          const d = r.JOUR instanceof Date ? r.JOUR : new Date(r.JOUR);
          const key = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!timeMap[key]) timeMap[key] = { label: key, ctp: 0, psm: 0 };
          timeMap[key].ctp = Number(r.OK);
        });
      } catch(e) {
        console.warn('[inscriptions/timeline/byDay]', e.message);
      }
    }

    const buckets = Object.values(timeMap).sort((a,b) => a.label.localeCompare(b.label));
    const peakBucket = [...buckets].sort((a,b) => (b.ctp+b.psm)-(a.ctp+a.psm))[0];

    // ── 6. Réponse ────────────────────────────────────
    res.json({
      success: true,
      meta   : { dd, df, totalCtp: ctpKpis.total, totalPsm: psmRows.length },
      kpis   : { total, enrolled, amount, successRate, adjustedRate, timeoutCount },
      timeline: { buckets, byDay:[], peak:peakBucket, launch: dd },
      ctp    : {
        networks      : ctpNetworks,
        failReasons   : Object.entries(ctpFailReasons).map(([k,v])=>({reason:k,count:v})),
        failByCategory: ctpFailByCategory,
      },
      psm    : {
        fsp      : Object.entries(psmFsp).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v})),
        moyen    : Object.entries(psmMoyen).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v})),
        mode     : Object.entries(psmMode).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v})),
        canal    : Object.entries(psmCanal).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v})),
        carte    : psmCarte,
        wallet   : psmWallet,
        virement : psmVirement,
      },
      insight: { enrolled, ctpEnrolled, psmEnrolled, psmCarte, psmWallet, psmVirement,
                 psmCarteVia, ctpDirect: ctpEnrolled-psmCarteVia, webCount, mobCount, ussdCount },
    });

  } catch(e) {
    console.error('[inscriptions/stats]', e.message);
    res.status(500).json({ success:false, error: e.message });
  }
});

module.exports = router;

// ── POST /api/inscriptions/rapport ─────────────────────────
// Génère PDF via script Python reportlab
router.post('/rapport', requireAuth, requireRole('admin'), async (req, res) => {
  const { stats } = req.body;
  if (!stats) return res.status(400).json({ success: false, error: 'stats manquantes' });

  try {
    const { execFileSync } = require('child_process');
    const fs   = require('fs');
    const tmp  = `/tmp/rapport_inscriptions_${Date.now()}.pdf`;

    // Passer les vraies données au script Python
    execFileSync('python3', [
      '/app/scripts/gen_rapport_inscriptions.py',
      tmp,
      JSON.stringify(stats),
    ], { timeout: 60000 });

    if (!fs.existsSync(tmp)) {
      return res.status(500).json({ success: false, error: 'Fichier PDF non généré' });
    }

    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);

    const date = new Date().toISOString().slice(0,10);
    res.set({
      'Content-Type'       : 'application/pdf',
      'Content-Disposition': `attachment; filename="Rapport_Inscriptions_${date}.pdf"`,
      'Content-Length'     : buf.length,
    });
    return res.send(buf);

  } catch(e) {
    console.error('[inscriptions/rapport]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});


module.exports = router;

// ── POST /api/inscriptions/rapport ────────────────────────
// Génère PDF + PPTX + DOCX à partir des stats calculées
router.post('/rapport', requireAuth, requireRole('admin'), async (req, res) => {
  const { stats, format = 'pdf' } = req.body;
  if (!stats) return res.status(400).json({ success: false, error: 'stats manquantes' });

  try {
    const { execSync } = require('child_process');
    const fs   = require('fs');
    const path = require('path');
    const now  = new Date();
    const dateStr = now.toLocaleDateString('fr-FR');
    const heureStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const timeStr = now.toLocaleString('fr-FR');
    const D = {
      ...stats,
      date_fin      : stats.meta?.df  || dateStr,
      date_debut    : stats.meta?.dd  || '20/08/2026',
      generated     : timeStr,
      heure_rapport : heureStr,
      date_rapport  : dateStr,
      enrolled      : stats.kpis?.enrolled      || 0,
      total         : stats.kpis?.total         || 0,
      amount        : stats.kpis?.amount        || 0,
      success_rate  : stats.kpis?.successRate   || 0,
      adjusted_rate : stats.kpis?.adjustedRate  || 0,
      timeout_count : stats.kpis?.timeoutCount  || 0,
      ctp_enrolled  : stats.insight?.ctpEnrolled  || 0,   // total cartes (direct CTP + cartes PSM)
      psm_enrolled  : stats.insight?.psmEnrolled  || 0,   // wallet uniquement
      psm_carte     : stats.insight?.psmCarteVia  || stats.psm?.carte     || 0,  // cartes via Paysmart
      psm_wallet    : stats.insight?.psmWallet    || stats.psm?.wallet    || 0,  // wallet Paysmart
      psm_virement  : stats.insight?.psmVirement  || stats.psm?.virement  || 0,  // virement Paysmart
      psm_total     : (stats.insight?.psmCarteVia  || stats.psm?.carte    || 0)
                    + (stats.insight?.psmWallet    || stats.psm?.wallet   || 0)
                    + (stats.insight?.psmVirement  || stats.psm?.virement || 0),
      ctp_direct    : stats.insight?.ctpDirect    || 0,   // cartes directement via CTP (hors PSM)
      web_count     : stats.insight?.webCount  || 0,
      mob_count     : stats.insight?.mobCount  || 0,
      ussd_count    : stats.insight?.ussdCount || 0,
      peak_label    : stats.timeline?.peak?.label  || '—',
      peak_count    : stats.timeline?.peak ? (stats.timeline.peak.ctp + stats.timeline.peak.psm) : 0,
      launch_date   : stats.timeline?.launch || '—',
      fail_timeout  : stats.ctp?.failByCategory?.timeout || 0,
      fail_auth3ds  : stats.ctp?.failByCategory?.auth3ds  || 0,
      fail_banque   : stats.ctp?.failByCategory?.banque   || 0,
      ctp_networks  : stats.ctp?.networks || [],
      psm_fsp       : stats.psm?.fsp     || [],
      psm_moyen     : stats.psm?.moyen   || [],
    };

    const fmt = n => (n||0).toLocaleString('fr-FR');
    const fmtTND = n => `${fmt(Math.round(n||0))} TND`;

    if (format === 'pdf') {
      const PDFDocument = require('pdfkit');
      const { PassThrough } = require('stream');
      const pdfBuffer = await new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks = [];
        const stream = new PassThrough();
        doc.pipe(stream);
        stream.on('data', c => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);

        const NAVY = '#0D1B3E', GOLD = '#E8A33D', TEAL = '#2BC5B4', GRAY = '#475569';
        const W = doc.page.width, M = 40;

        // Header
        doc.rect(0,0,W,70).fill(NAVY);
        doc.fillColor(GOLD).fontSize(16).font('Helvetica-Bold').text('Monetique Tunisie', M, 15);
        doc.fillColor(TEAL).fontSize(12).font('Helvetica').text('Paysmart  |  ClicToPay', M, 35);
        doc.fillColor('white').fontSize(9)
           .text(`SITUATION AU ${D.date_rapport.toUpperCase()} A ${D.heure_rapport}`, W-220, 22, { width: 180, align: 'right' })
           .text(`Genere le ${D.generated}`, W-220, 36, { width: 180, align: 'right' });

        // Title
        doc.moveDown(3);
        doc.fillColor(NAVY).fontSize(18).font('Helvetica-Bold')
           .text('Rapport de suivi — Inscriptions Scolaires', M, doc.y, { align: 'center', width: W-2*M });
        doc.fillColor(GRAY).fontSize(11).font('Helvetica')
           .text(`Campagne du ${D.date_debut} au ${D.date_fin}`, { align: 'center', width: W-2*M });
        doc.moveDown(0.5);
        doc.moveTo(M,doc.y).lineTo(W-M,doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
        doc.moveDown(0.8);

        // KPIs
        const kpis = [
          [fmt(D.enrolled), 'Eleves inscrits'],
          [fmtTND(D.amount), 'Montant encaisse'],
          [`${D.success_rate}%`, 'Taux de succes'],
          [`${D.adjusted_rate}%`, 'Taux ajuste'],
        ];
        const kw = (W-2*M)/4;
        kpis.forEach(([val,lbl],i) => {
          const x = M + i*kw;
          doc.rect(x+2, doc.y, kw-4, 50).fill('#F7F8FA');
          const y = doc.y + 8;
          doc.fillColor(NAVY).fontSize(18).font('Helvetica-Bold').text(val, x+2, y, {width:kw-4,align:'center'});
          doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(lbl, x+2, y+22, {width:kw-4,align:'center'});
        });
        doc.moveDown(4.5);

        // Section 1 — Synthèse
        doc.rect(M,doc.y,W-2*M,20).fill(NAVY);
        doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
           .text('1.  SYNTHESE DU LANCEMENT', M+8, doc.y-16);
        doc.moveDown(1.8);

        // Texte situation fidèle au modèle validé
        const situationLines = [
          `${fmt(D.enrolled)} eleves inscrits via SMT —`,
          `${fmt(D.ctp_enrolled)} par cartes bancaires directement via ClicToPay ·`,
          `${fmt(D.psm_total)} via Paysmart :`,
          `   ${fmt(D.psm_carte)} paiements par cartes via Paysmart a partir du site d'inscription.`,
          `   ${fmt(D.psm_wallet)} par wallet Mobile.`,
          ...(D.psm_virement > 0 ? [`   ${fmt(D.psm_virement)} par virement.`] : []),
          `Canaux : ${fmt(D.web_count)} WEB · ${fmt(D.mob_count)} MOBILE · ${fmt(D.ussd_count)} USSD.`,
        ];
        situationLines.forEach((line, i) => {
          const isBold = i === 0;
          const isIndented = line.startsWith('   ');
          doc.fillColor(isBold ? NAVY : GRAY)
             .fontSize(9.5)
             .font(isBold ? 'Helvetica-Bold' : 'Helvetica')
             .text(line, M + (isIndented ? 16 : 0), doc.y, { width: W - 2*M - (isIndented ? 16 : 0) });
          doc.moveDown(0.2);
        });
        doc.moveDown(0.4);
        doc.fillColor(GRAY).fontSize(9.5).font('Helvetica')
           .text(`La campagne a demarre le ${D.launch_date}. Pic d'activite : ${fmt(D.peak_count)} transactions a ${D.peak_label}.`, {width:W-2*M, align:'justify'});
        doc.moveDown(0.6);

        // Section 2
        doc.rect(M,doc.y,W-2*M,20).fill(NAVY);
        doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
           .text('2.  REPARTITION PAR PLATEFORME', M+8, doc.y-16);
        doc.moveDown(1.8);

        const platRows = [
          ['ClicToPay (total cartes)', fmt(D.ctp_enrolled),  `${Math.round((D.ctp_enrolled||1)/(D.enrolled||1)*100)}%`, 'VISA/MC'],
          ['  dont via Paysmart',      fmt(D.psm_carte),     `${Math.round((D.psm_carte||0)/(D.ctp_enrolled||1)*100)}%`, 'Carte'],
          ['Paysmart Wallet',          fmt(D.psm_wallet),    `${Math.round((D.psm_wallet||0)/(D.enrolled||1)*100)}%`,    'Wallet/Flouci'],
          ...(D.psm_virement > 0 ? [['Paysmart Virement', fmt(D.psm_virement), `${Math.round((D.psm_virement||0)/(D.enrolled||1)*100)}%`, 'Virement']] : []),
        ];
        const cols = [5,3.5,2.5,4.5];
        ['Plateforme','Inscrits','Part','Moyen'].forEach((h,i) => {
          doc.rect(M+cols.slice(0,i).reduce((a,b)=>a+b*40,0), doc.y, cols[i]*40, 16).fill('#1B4F8C');
          doc.fillColor('white').fontSize(8).font('Helvetica-Bold')
             .text(h, M+cols.slice(0,i).reduce((a,b)=>a+b*40,0)+4, doc.y-12, {width:cols[i]*40-8});
        });
        doc.moveDown(1.5);
        platRows.forEach((row,ri) => {
          row.forEach((cell,i) => {
            doc.rect(M+cols.slice(0,i).reduce((a,b)=>a+b*40,0), doc.y, cols[i]*40, 16)
               .fill(ri%2===0?'white':'#F7F8FA');
            doc.fillColor(NAVY).fontSize(8).font('Helvetica')
               .text(cell, M+cols.slice(0,i).reduce((a,b)=>a+b*40,0)+4, doc.y-12, {width:cols[i]*40-8});
          });
          doc.moveDown(1.5);
        });
        doc.moveDown(0.5);

        // Section 3
        doc.rect(M,doc.y,W-2*M,20).fill(NAVY);
        doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
           .text('3.  ANALYSE QUALITATIVE', M+8, doc.y-16);
        doc.moveDown(1.8);
        doc.fillColor(GRAY).fontSize(9.5).font('Helvetica')
           .text(`Taux brut : ${D.success_rate}%  |  Taux ajuste (hors expirations) : ${D.adjusted_rate}%`, {width:W-2*M});
        doc.moveDown(0.4);
        doc.fillColor(GRAY).fontSize(9.5)
           .text(`Sessions expirees : ${fmt(D.fail_timeout)}  |  Echecs 3DS : ${fmt(D.fail_auth3ds)}  |  Refus bancaires : ${fmt(D.fail_banque)}`, {width:W-2*M});
        doc.moveDown(0.5);
        doc.rect(M,doc.y,W-2*M,40).fill('#FBE9D2');
        doc.fillColor('#7B3A00').fontSize(9).font('Helvetica')
           .text('Le taux ajuste confirme la robustesse technique des plateformes. Les sessions expirees resultent d\'un comportement utilisateur et non d\'un incident technique. Recommandation : renforcer la communication sur le delai de finalisation et l\'OTP.', M+8, doc.y+4, {width:W-2*M-16});
        doc.moveDown(3);

        // Footer
        doc.moveTo(M,doc.y).lineTo(W-M,doc.y).strokeColor('#E2E8F0').stroke();
        doc.fillColor(GRAY).fontSize(8)
           .text(`Monetique Tunisie — Document confidentiel — ${D.generated}`, {align:'center',width:W-2*M});

        doc.end();
      });

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Rapport_Inscriptions_${new Date().toISOString().slice(0,10)}.pdf"`,
      });
      return res.send(pdfBuffer);
    }

    res.status(400).json({ success: false, error: `Format '${format}' non supporté depuis l'API — utilisez le téléchargement direct` });

  } catch(e) {
    console.error('[inscriptions/rapport]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});
