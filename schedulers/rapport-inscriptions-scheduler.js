// schedulers/rapport-inscriptions.js
// Génère et envoie le rapport PDF inscriptions scolaires toutes les heures
'use strict';

const { execFileSync } = require('child_process');
const fs               = require('fs');
const oracledb         = require('oracledb');

const RECIPIENT = 'wissem.baghdadi@monetiquetunisie.com';
const SCRIPT    = '/app/scripts/gen_rapport_inscriptions.py';

function getDateRange() {
  const now   = new Date();
  const today = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
  return { date_debut: '20/08/2026', date_fin: today };
}

function categorizeReason(reason) {
  if (!reason) return 'banque';
  const r = String(reason);
  for (const c of ['-2007','-2013','341022','341023']) if (r.includes(c)) return 'timeout';
  for (const c of ['-2006','341018','341024','341025']) if (r.includes(c)) return 'auth3ds';
  return 'banque';
}

function mapCtpState(s) {
  const v = String(s||'').toLowerCase();
  if (v.includes('deposited')||v.includes('approved')) return 'ok';
  if (v.includes('declined')||v.includes('failed'))    return 'fail';
  return 'pending';
}

function mapPsmState(s) {
  return (s==='PAID'||s==='Payee') ? 'ok' : 'pending';
}

async function fetchStats(pools, { date_debut, date_fin }) {
  const { oraclePool, sqlPool } = pools;
  const dd = date_debut, df = date_fin;
  let ctpRows = [], psmRows = [];

  if (oraclePool) {
    const conn = await oraclePool.getConnection();
    try {
      const r = await conn.execute(
        `SELECT T.TRANS_DATE, T.PAYMENT_STATE, T.AMOUNT,
                T.ORDERNUMBER, T.ACTION_CODE_INT,
                NVL(T.TEXT,'') AS REASON, NVL(T.PAYMENT_SYSTEM,'') AS NETWORK
         FROM BPCTRANSACTIONS T
         WHERE T.PROCESSING_ID = :pid
           AND T.TRANS_DATE >= TO_DATE(:dd,'DD/MM/YYYY')
           AND T.TRANS_DATE <= TO_DATE(:df,'DD/MM/YYYY')+1-1/86400`,
        { pid: '0383026168', dd, df },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      ctpRows = (r.rows||[]).map(row => ({
        _src:'ctp', ts:row.TRANS_DATE,
        state:mapCtpState(row.PAYMENT_STATE),
        amount:row.AMOUNT?row.AMOUNT/1000:null,
        network:row.NETWORK||null,
        reason:row.ACTION_CODE_INT?`${row.ACTION_CODE_INT}: ${row.REASON}`:null,
      }));
    } finally { await conn.close(); }
  }

  if (sqlPool) {
    try {
      const toSql = s => { const [d,m,y]=s.split('/'); return `${y}-${m}-${d}`; };
      const r = await sqlPool.request().query(
        `SELECT [Date],[Heure],[Etat],[Montant],[FSP],[Canal],[Moyen],[mode]
         FROM [switchdb].[dbo].[TO_QLIK_BI_new]
         WHERE [Facturier]='CNTE'
           AND CONVERT(date,[Date],103)>=CONVERT(date,'${toSql(dd)}',23)
           AND CONVERT(date,[Date],103)<=CONVERT(date,'${toSql(df)}',23)`
      );
      psmRows = (r.recordset||[]).map(row => {
        const p=(row.Date||'').split('/');
        const iso=p.length===3?`${p[2]}-${p[1]}-${p[0]}`:row.Date;
        return { _src:'psm', ts:new Date(`${iso}T${(row.Heure||'00:00').slice(0,5)}:00`),
          state:mapPsmState(row.Etat), amount:row.Montant?Number(row.Montant)/1000:null,
          network:row.FSP||null, moyen:row.Moyen||null, mode:row.mode||null, canal:row.Canal||null };
      });
    } catch(e) { console.warn('[rapport-cron] PSM:', e.message); }
  }

  const all=[...ctpRows,...psmRows], okRows=all.filter(r=>r.state==='ok');
  const enrolled=okRows.length, amount=okRows.reduce((s,r)=>s+(r.amount||0),0);
  const failRows=all.filter(r=>r.state==='fail');
  const successRate=all.length>0?Math.round(enrolled/all.length*1000)/10:0;
  const failCat={timeout:0,auth3ds:0,banque:0};
  failRows.filter(r=>r._src==='ctp').forEach(r=>{failCat[categorizeReason(r.reason)]++;});
  const timeoutCnt=failCat.timeout;
  const adjustedRate=(all.length-timeoutCnt)>0?Math.round(enrolled/(all.length-timeoutCnt)*1000)/10:successRate;

  // Timeline
  let tsMax=-Infinity,tsMin=Infinity;
  for(const r of all){const v=r.ts;const t=(v instanceof Date)?v.getTime():new Date(v).getTime();if(t>0&&t===t){if(t>tsMax)tsMax=t;if(t<tsMin)tsMin=t;}}
  const span=(tsMax>tsMin)?(tsMax-tsMin)/3600000:0, byDay=span>72, map={};
  for(const r of all){const v=r.ts;const d=(v instanceof Date)?v:new Date(v);if(!d||isNaN(d.getTime())||d.getTime()<=0)continue;
    const key=byDay?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      :`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}h`;
    if(!map[key])map[key]={label:key,ctp:0,psm:0};if(r._src==='ctp')map[key].ctp++;else map[key].psm++;}
  const buckets=Object.values(map).sort((a,b)=>a.label.localeCompare(b.label));
  const peakBucket=[...buckets].sort((a,b)=>(b.ctp+b.psm)-(a.ctp+a.psm))[0];

  const ctpNets={},psmFsp={},psmMoyen={},psmMode={},psmCanal={};
  let psmCarte=0,psmWallet=0;
  ctpRows.filter(r=>r.state==='ok'&&r.network).forEach(r=>{ctpNets[r.network]=(ctpNets[r.network]||0)+1;});
  psmRows.filter(r=>r.state==='ok').forEach(r=>{
    if(r.network)psmFsp[r.network]=(psmFsp[r.network]||0)+1;
    if(r.moyen)psmMoyen[r.moyen]=(psmMoyen[r.moyen]||0)+1;
    if(r.mode)psmMode[r.mode]=(psmMode[r.mode]||0)+1;
    const c=r.canal||'Non renseigne';psmCanal[c]=(psmCanal[c]||0)+1;
    if(r.moyen){if(/^Carte/i.test(r.moyen))psmCarte++;else if(/^Wallet|Flouci/i.test(r.moyen))psmWallet++;}
  });

  const ctpEnrolled=ctpRows.filter(r=>r.state==='ok').length;
  const psmEnrolled=psmRows.filter(r=>r.state==='ok').length;

  return { success:true,
    meta:{dd,df,totalCtp:ctpRows.length,totalPsm:psmRows.length},
    kpis:{total:all.length,enrolled,amount,successRate,adjustedRate,timeoutCount:timeoutCnt},
    timeline:{buckets,byDay,peak:peakBucket},
    ctp:{networks:Object.entries(ctpNets).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v})),
         failByCategory:failCat,failReasons:[]},
    psm:{fsp:Object.entries(psmFsp).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v})),
         moyen:Object.entries(psmMoyen).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v})),
         mode:Object.entries(psmMode).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v})),
         canal:Object.entries(psmCanal).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v})),
         carte:psmCarte,wallet:psmWallet},
    insight:{enrolled,ctpEnrolled,psmEnrolled,psmCarte,psmWallet,
             webCount:psmRows.filter(r=>r.canal==='WEB').length,
             mobCount:psmRows.filter(r=>r.canal==='MOBILE').length,
             ussdCount:psmRows.filter(r=>r.canal==='USSD').length},
  };
}

async function sendRapportHoraire(pools) {
  const now   = new Date();
  const heure = `${String(now.getHours()).padStart(2,'0')}h${String(now.getMinutes()).padStart(2,'0')}`;
  const date_fr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
  console.log(`[rapport-cron] Generation rapport ${date_fr} ${heure}...`);

  try {
    const stats = await fetchStats(pools, getDateRange());
    const tmpJson = `/tmp/rcron_${Date.now()}.json`;
    const tmpPdf  = `/tmp/rcron_${Date.now()}.pdf`;
    fs.writeFileSync(tmpJson, JSON.stringify(stats));

    execFileSync('python3', [SCRIPT, tmpPdf, tmpJson], { timeout: 90000 });
    if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
    if (!fs.existsSync(tmpPdf)) throw new Error('PDF non genere');

    const pdfBuf = fs.readFileSync(tmpPdf);
    fs.unlinkSync(tmpPdf);

    const fmt = n => (n||0).toLocaleString('fr-FR');
    const ins = stats.insight||{};
    const kpi = stats.kpis||{};

    const ctpPct  = ins.enrolled > 0 ? Math.round(ins.ctpEnrolled/ins.enrolled*100) : 0;
    const psmPct  = ins.enrolled > 0 ? Math.round(ins.psmEnrolled/ins.enrolled*100) : 0;
    const cartePct= ins.psmEnrolled > 0 ? Math.round(ins.psmCarte/ins.psmEnrolled*100) : 0;
    const wallPct = ins.psmEnrolled > 0 ? Math.round(ins.psmWallet/ins.psmEnrolled*100) : 0;
    const canalTotal = ins.webCount + ins.mobCount + ins.ussdCount;
    const webPct  = canalTotal > 0 ? Math.round(ins.webCount/canalTotal*100) : 0;
    const mobPct  = canalTotal > 0 ? Math.round(ins.mobCount/canalTotal*100) : 0;
    const ussdPct = canalTotal > 0 ? Math.round(ins.ussdCount/canalTotal*100) : 0;

    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#EEF2F7;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:32px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#0D1B3E 0%,#1B3A6B 100%);padding:28px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="display:inline-block;background:#E8A33D;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:700;color:#0D1B3E;letter-spacing:0.5px;">MT</div>
        <span style="color:#E8A33D;font-size:18px;font-weight:700;margin-left:10px;vertical-align:middle;">Monetique Tunisie</span>
      </td>
      <td align="right" style="color:#8B94A8;font-size:11px;line-height:1.5;">
        Inscriptions Scolaires<br/>
        <span style="color:#2BC5B4;font-weight:600;">${date_fr} &bull; ${heure}</span>
      </td>
    </tr></table>
    <div style="margin-top:16px;color:white;font-size:22px;font-weight:700;letter-spacing:-0.3px;">
      Rapport de suivi en temps reel
    </div>
    <div style="color:#8B94A8;font-size:12px;margin-top:4px;">Etat des inscriptions scolaires en ligne — Tunisie</div>
  </td></tr>

  <!-- HERO KPI -->
  <tr><td style="padding:0 32px;">
    <div style="background:linear-gradient(90deg,#FBE9D2,#FFF8EE);border-left:5px solid #E8A33D;border-radius:0 12px 12px 0;padding:20px 24px;margin:24px 0 0;">
      <div style="font-size:36px;font-weight:800;color:#0D1B3E;letter-spacing:-1px;">${fmt(ins.enrolled)}</div>
      <div style="font-size:14px;color:#7B3A00;font-weight:600;margin-top:2px;">eleves inscrits via SMT</div>
    </div>
  </td></tr>

  <!-- REPARTITION -->
  <tr><td style="padding:20px 32px 0;">
    <div style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Repartition par plateforme</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <!-- CTP -->
        <td width="48%" style="background:#FBF4E8;border:1px solid #F0D9A8;border-radius:10px;padding:16px;">
          <div style="font-size:10px;font-weight:700;color:#C97F1F;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">
            &#9646; ClicToPay
          </div>
          <div style="font-size:26px;font-weight:800;color:#0D1B3E;">${fmt(ins.ctpEnrolled)}</div>
          <div style="font-size:11px;color:#7B3A00;margin-top:2px;">paiements par carte &bull; ${ctpPct}%</div>
          <!-- Barre progression -->
          <div style="background:#E8D5A8;border-radius:4px;height:4px;margin-top:10px;">
            <div style="background:#E8A33D;border-radius:4px;height:4px;width:${ctpPct}%;"></div>
          </div>
        </td>
        <td width="4%"></td>
        <!-- Paysmart -->
        <td width="48%" style="background:#E8F8F6;border:1px solid #A8E6DF;border-radius:10px;padding:16px;">
          <div style="font-size:10px;font-weight:700;color:#1A9688;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">
            &#9646; Paysmart CNTE
          </div>
          <div style="font-size:26px;font-weight:800;color:#0D1B3E;">${fmt(ins.psmEnrolled)}</div>
          <div style="font-size:11px;color:#1A6B62;margin-top:2px;">carte + wallet &bull; ${psmPct}%</div>
          <div style="background:#A8DFD8;border-radius:4px;height:4px;margin-top:10px;">
            <div style="background:#2BC5B4;border-radius:4px;height:4px;width:${psmPct}%;"></div>
          </div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- PAYSMART DETAIL -->
  <tr><td style="padding:16px 32px 0;">
    <div style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Detail Paysmart</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="48%" style="background:#F0FBF9;border-radius:8px;padding:12px 14px;border:1px solid #C8EDE9;">
          <div style="font-size:10px;color:#1A9688;font-weight:600;">Paiements par carte</div>
          <div style="font-size:20px;font-weight:700;color:#0D1B3E;margin-top:2px;">${fmt(ins.psmCarte)}</div>
          <div style="font-size:10px;color:#64748B;">via site inscription &bull; ${cartePct}%</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background:#F5F0FD;border-radius:8px;padding:12px 14px;border:1px solid #D4C1F5;">
          <div style="font-size:10px;color:#6D28D9;font-weight:600;">Wallet mobile</div>
          <div style="font-size:20px;font-weight:700;color:#0D1B3E;margin-top:2px;">${fmt(ins.psmWallet)}</div>
          <div style="font-size:10px;color:#64748B;">IZI, Flouci, Mobile &bull; ${wallPct}%</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- CANAUX -->
  <tr><td style="padding:16px 32px 0;">
    <div style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Canaux d'acces</div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="32%" align="center" style="background:#EFF6FF;border-radius:8px;padding:12px;border:1px solid #BFDBFE;">
        <div style="font-size:18px;font-weight:700;color:#1D4ED8;">${fmt(ins.webCount)}</div>
        <div style="font-size:10px;font-weight:700;color:#3B82F6;margin-top:2px;">WEB</div>
        <div style="font-size:10px;color:#64748B;">${webPct}%</div>
      </td>
      <td width="2%"></td>
      <td width="32%" align="center" style="background:#E8F8F6;border-radius:8px;padding:12px;border:1px solid #A8E6DF;">
        <div style="font-size:18px;font-weight:700;color:#0D9488;">${fmt(ins.mobCount)}</div>
        <div style="font-size:10px;font-weight:700;color:#2BC5B4;margin-top:2px;">MOBILE</div>
        <div style="font-size:10px;color:#64748B;">${mobPct}%</div>
      </td>
      <td width="2%"></td>
      <td width="32%" align="center" style="background:#FFFBEB;border-radius:8px;padding:12px;border:1px solid #FDE68A;">
        <div style="font-size:18px;font-weight:700;color:#D97706;">${fmt(ins.ussdCount)}</div>
        <div style="font-size:10px;font-weight:700;color:#E8A33D;margin-top:2px;">USSD</div>
        <div style="font-size:10px;color:#64748B;">${ussdPct}%</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- INDICATEURS QUALITE -->
  <tr><td style="padding:16px 32px 0;">
    <div style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Indicateurs de qualite</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
      <tr style="background:#F7F8FA;">
        <td style="padding:10px 14px;font-size:11px;color:#64748B;border-bottom:1px solid #E2E8F0;">Transactions totales</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0D1B3E;border-bottom:1px solid #E2E8F0;" align="right">${fmt(kpi.total)}</td>
        <td style="padding:10px 14px;font-size:11px;color:#64748B;border-bottom:1px solid #E2E8F0;border-left:1px solid #E2E8F0;">Taux de succes brut</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0D1B3E;border-bottom:1px solid #E2E8F0;" align="right">${kpi.successRate}%</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-size:11px;color:#64748B;">Sessions expirees</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#E5556B;" align="right">${fmt(kpi.timeoutCount)}</td>
        <td style="padding:10px 14px;font-size:11px;color:#64748B;border-left:1px solid #E2E8F0;">Taux ajuste</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#2BC5B4;" align="right">${kpi.adjustedRate}%</td>
      </tr>
    </table>
  </td></tr>

  <!-- NOTE PDF -->
  <tr><td style="padding:16px 32px 24px;">
    <div style="background:#F0FBF9;border:1px solid #A8E6DF;border-radius:8px;padding:12px 16px;font-size:11px;color:#1A6B62;">
      &#128196; Le rapport detaille complet (PDF) est joint a cet email.<br/>
      <span style="color:#94A3B8;">Prochain envoi automatique dans 1 heure.</span>
    </div>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#0D1B3E;padding:16px 32px;text-align:center;">
    <div style="font-size:10px;color:#4A5568;">
      Monetique Tunisie &bull; ClicToPay &bull; Paysmart &mdash; Document confidentiel
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

    const { sendMail } = require('../config/mailer');
    await sendMail({
      to         : RECIPIENT,
      subject    : `[ClicToPay] Inscriptions scolaires — ${fmt(ins.enrolled)} eleves — ${date_fr} ${heure}`,
      html,
      attachments: [{
        filename   : `Rapport_Inscriptions_${date_fr.replace(/\//g,'-')}_${heure}.pdf`,
        content    : pdfBuf,
        contentType: 'application/pdf',
      }],
    });

    console.log(`[rapport-cron] Rapport envoye a ${RECIPIENT} — ${fmt(ins.enrolled)} inscrits`);
  } catch(e) {
    console.error('[rapport-cron] Erreur:', e.message);
  }
}

function startRapportScheduler(pools) {
  console.log(`[rapport-cron] Scheduler demarre — envoi toutes les heures a ${RECIPIENT}`);
  sendRapportHoraire(pools);
  setInterval(() => sendRapportHoraire(pools), 60 * 60 * 1000);
}

module.exports = { startRapportScheduler };
