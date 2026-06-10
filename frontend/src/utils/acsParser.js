// src/utils/acsParser.js
// Moteur de parsing des métriques ACS 3DS2 — porté depuis acs.html

export function parseAcsMetrics(data) {
  if (!data) return null;
  const C = data.counters || {}, M = data.meters || {}, T = data.timers || {};

  const aT  = T['acs.3ds2.areq.incoming.timer']   || {};
  const dT  = T['acs.3ds2.ds.connection.timer']    || {};
  const rT  = T['acs.3ds2.rba.advice.timer']       || {};
  const rkT = T['acs.3ds2.rba.check.timer']        || {};

  const areqTotal = aT.count || 0;
  const dsTotal   = (C['acs.3ds2.ds.connection']              || {}).count || 0;
  const abandon   = (C['acs.3ds2.counter.challenge.abandon']  || {}).count || 0;
  const srvErr    = (C['acs.3ds2.counter.error.server']       || {}).count || 0;
  const fmtErr    = (C['acs.3ds2.counter.error.format']       || {}).count || 0;
  const areqErr   = (C['acs.3ds2.areq.counter.error']         || {}).count || 0;
  const procErr   = (C['acs.3ds2.areq.counter.error.processing'] || {}).count || 0;
  const rbaTotal  = (C['acs.3ds2.rba.advice']                 || {}).count || 0;

  // ── Par banque ────────────────────────────────────────────
  const banks = {};

  for (const [k, v] of Object.entries(C)) {
    if (!k.includes('ds.connection.PROFILE_NAME.') || !k.includes('NETWORK') || !k.includes('REQUEST_STATUS')) continue;
    const p  = k.split('.');
    const pi = p.indexOf('PROFILE_NAME') + 1;
    const ni = p.indexOf('NETWORK') + 1;
    const si = p.indexOf('REQUEST_STATUS') + 1;
    const bank = p[pi], net = p[ni], status = p[si];
    if (!bank) continue;
    if (!banks[bank]) banks[bank] = { ds:0, ok:0, err:0, to:0, visa:0, mc:0, ae:0, pe:0, sms:0, rba:0 };
    banks[bank].ds  += v.count || 0;
    if (status === 'success') banks[bank].ok   += v.count || 0;
    if (status === 'error')   banks[bank].err  += v.count || 0;
    if (status === 'timeout') banks[bank].to   += v.count || 0;
    if (net === 'VISA')       banks[bank].visa += v.count || 0;
    if (net === 'MASTERCARD') banks[bank].mc   += v.count || 0;
  }

  for (const [k, v] of Object.entries(C)) {
    if (k.includes('areq.counter.error.PROFILE_NAME.') && !k.includes('processing')) {
      const b = k.split('PROFILE_NAME.')[1];
      if (banks[b]) banks[b].ae = v.count || 0;
    }
    if (k.includes('areq.counter.error.processing.PROFILE_NAME.')) {
      const b = k.split('PROFILE_NAME.')[1];
      if (banks[b]) banks[b].pe = v.count || 0;
    }
    if (k.includes('rba.advice.PROFILE_NAME.') && k.includes('REQUEST_STATUS.success')) {
      const b = k.split('PROFILE_NAME.')[1].split('.')[0];
      if (banks[b]) banks[b].rba = (banks[b].rba || 0) + (v.count || 0);
    }
  }

  for (const [k, v] of Object.entries(M)) {
    if (k.startsWith('acs.sms.send.PROFILE_NAME.')) {
      const r = k.replace('acs.sms.send.PROFILE_NAME.', '');
      if (!r.includes('.') && banks[r]) banks[r].sms = v.count || 0;
    }
  }

  let smsApp = 0, smsBrow = 0;
  for (const [k, v] of Object.entries(M)) {
    if (k.includes('sms.send.PROFILE_NAME.') && k.includes('DEVICE_CHANNEL.APP_BASED')  && !k.includes('TRANSACTION')) smsApp  += v.count || 0;
    if (k.includes('sms.send.PROFILE_NAME.') && k.includes('DEVICE_CHANNEL.BROWSER')    && !k.includes('TRANSACTION')) smsBrow += v.count || 0;
  }

  const ranked    = Object.entries(banks).sort((a, b) => b[1].ds - a[1].ds);
  const visaTotal = ranked.reduce((s, [, d]) => s + d.visa, 0);
  const mcTotal   = ranked.reduce((s, [, d]) => s + d.mc,   0);
  const smsTotal  = ranked.reduce((s, [, d]) => s + d.sms,  0);
  const dsOk      = ranked.reduce((s, [, d]) => s + d.ok,   0);
  const dsErrSum  = ranked.reduce((s, [, d]) => s + d.err,  0);
  const dsToSum   = ranked.reduce((s, [, d]) => s + d.to,   0);

  return {
    aT, dT, rT, rkT,
    areqTotal, dsTotal, abandon, srvErr, fmtErr, areqErr, procErr, rbaTotal,
    banks, ranked,
    visaTotal, mcTotal, smsTotal, smsApp, smsBrow,
    dsOk, dsErrSum, dsToSum,
    bankCnt : Object.keys(banks).length,
    version : data.version || '4.0.0',
    rate    : aT.m1_rate || 0,
  };
}

export const fmt = n => (n || 0).toLocaleString('fr-FR');
export const ms  = v => v != null ? `${(v * 1000).toFixed(0)} ms` : '—';
export const pct = (n, d) => d > 0 ? `${(n / d * 100).toFixed(3)}%` : '—';
