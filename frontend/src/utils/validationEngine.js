// src/utils/validationEngine.js
// Moteur d'analyse des cahiers de recettes

export const CRITICAL_IDS = ['CTP-01','CTP-02','CTP-03','CTP-04','CTP-05'];

export const CASE_NAMES = {
  'CTP-01': 'Enregistrement commande valide',
  'CTP-02': 'Redirection page de paiement',
  'CTP-03': 'Paiement accepté (carte 4509)',
  'CTP-04': 'Paiement refusé (carte 5104)',
  'CTP-05': 'Vérification statut sur returnUrl',
  'CTP-06': 'Paramètres manquants register.do',
  'CTP-07': 'Doublon orderNumber',
  'CTP-08': 'orderId inexistant',
};

export const PRIORITY = {
  'CTP-01':'Critique','CTP-02':'Critique','CTP-03':'Critique',
  'CTP-04':'Critique','CTP-05':'Critique',
  'CTP-06':'Haute',   'CTP-07':'Haute',   'CTP-08':'Normale',
};

export function normalizeResult(r) {
  const s = String(r || '').toLowerCase().trim();
  if (s.includes('réussi') || s.includes('reussi') || s === 'ok' || s === 'pass' || s === 'passed' || s.startsWith('oui')) return 'pass';
  if (s.includes('échoué') || s.includes('echoue') || s.includes('fail') || s === 'ko' || s.startsWith('non')) return 'fail';
  return 'pending';
}

export function validateJsonResponse(tcId, json) {
  const errors = [];
  if (!json || typeof json !== 'object') return ['JSON non parsable'];
  switch(tcId) {
    case 'CTP-01':
      if (!json.orderId) errors.push('orderId manquant dans la réponse');
      if (!json.formUrl) errors.push('formUrl manquant dans la réponse');
      if (json.formUrl && !String(json.formUrl).startsWith('https://test.clictopay.com'))
        errors.push('formUrl ne commence pas par https://test.clictopay.com');
      if (json.errorCode && String(json.errorCode) !== '0')
        errors.push(`errorCode = ${json.errorCode} (attendu : absent ou 0)`);
      break;

    case 'CTP-03':
      // orderStatus = 2 obligatoire
      if (json.orderStatus !== 2 && json.orderStatus !== '2')
        errors.push(`orderStatus = ${json.orderStatus} (attendu : 2 — paiement accepté)`);
      // actionCode = 0 obligatoire
      if (json.actionCode !== 0 && json.actionCode !== '0')
        errors.push(`actionCode = ${json.actionCode} (attendu : 0)`);
      // amount présent et > 0
      if (!json.amount || Number(json.amount) <= 0)
        errors.push(`amount absent ou nul (attendu : montant en millimes > 0)`);
      // cardAuthInfo.pan commence par 4509
      if (json.cardAuthInfo) {
        const pan = String(json.cardAuthInfo.pan || '').replace(/\*/g, '');
        if (!pan.startsWith('4509') && !pan.startsWith('4509'))
          errors.push(`cardAuthInfo.pan = ${json.cardAuthInfo.pan} (attendu : commence par 4509 — carte de test acceptée)`);
      } else {
        errors.push('cardAuthInfo absent — informations carte manquantes pour un paiement accepté');
      }
      break;

    case 'CTP-04':
      // orderStatus ≠ 2 obligatoire
      if (json.orderStatus === 2 || json.orderStatus === '2')
        errors.push('orderStatus = 2 — attendu différent de 2 pour un paiement refusé');
      // actionCode ≠ 0 obligatoire
      if (json.actionCode === 0 || json.actionCode === '0')
        errors.push('actionCode = 0 — attendu non-zero pour un paiement refusé');
      // cardAuthInfo.pan commence par 5104 (si présent)
      if (json.cardAuthInfo?.pan) {
        const pan = String(json.cardAuthInfo.pan).replace(/\*/g, '');
        if (!pan.startsWith('5104'))
          errors.push(`cardAuthInfo.pan = ${json.cardAuthInfo.pan} (attendu : commence par 5104 — carte de test refusée)`);
      }
      break;

    case 'CTP-05':
      if (json.orderStatus === 2 || json.orderStatus === '2')
        errors.push('orderStatus = 2 alors que le paiement ne devrait pas être validé sans confirmation API');
      break;

    case 'CTP-06':
      // errorCode ≠ 0 obligatoire
      if (!json.errorCode || String(json.errorCode) === '0')
        errors.push('errorCode absent ou = 0 — une erreur était attendue (paramètre manquant)');
      // errorMessage présent et descriptif
      if (!json.errorMessage || String(json.errorMessage).trim() === '')
        errors.push('errorMessage absent — un message d\'erreur descriptif est attendu');
      // orderId ne doit pas être généré
      if (json.orderId)
        errors.push('orderId présent — ne devrait pas être généré en cas d\'erreur');
      break;

    case 'CTP-07':
      // Deux résultats acceptables :
      // 1. errorCode ≠ 0 (doublon explicitement rejeté)
      // 2. orderId retourné (même orderId = doublon géré silencieusement, mais accepté)
      const hasError  = json.errorCode && String(json.errorCode) !== '0';
      const hasOrder  = !!json.orderId;
      if (!hasError && !hasOrder)
        errors.push('Ni errorCode (≠0) ni orderId dans la réponse — comportement doublon indéterminé');
      // Si errorCode présent, il doit être 1 (doublon standard ClicToPay)
      if (json.errorCode && String(json.errorCode) !== '0' && String(json.errorCode) !== '1')
        errors.push(`errorCode = ${json.errorCode} (attendu : 1 pour doublon orderNumber)`);
      break;

    case 'CTP-08':
      if (!json.errorCode || String(json.errorCode) === '0')
        errors.push('errorCode absent ou = 0 — une erreur était attendue pour orderId inexistant');
      break;
  }
  return errors;
}

// XLSX est passé en paramètre pour éviter la dépendance à window.XLSX
export function analyzeWorkbook(XLSX, wb, filename) {
  const result = {
    filename,
    date        : new Date().toISOString(),
    merchant    : {},
    cases       : [],
    anomalies   : [],
    pass: 0, fail: 0, pending: 0, total: 0,
    criticalPass : 0,
    criticalTotal: CRITICAL_IDS.length,
    verdict      : 'pending',
    isBlankTemplate: false,
  };

  // ── Feuille Informations ─────────────────────────────
  const wsInfo = wb.Sheets['Informations'];
  if (wsInfo) {
    const data = XLSX.utils.sheet_to_json(wsInfo, { header: 1, defval: '' });
    const findVal = (label) => {
      for (const row of data) {
        if (String(row[1] || '').toLowerCase().includes(label.toLowerCase()))
          return String(row[2] || '').trim();
      }
      return '';
    };
    result.merchant = {
      raisonSociale: findVal('Raison sociale'),
      processingId : findVal('Processing ID'),
      terminalId   : findVal('Terminal ID'),
      email        : findVal('Email'),
      dateExecution: findVal('Date'),
      siteUrl      : findVal('Site marchand') || findVal('Site web') || findVal('Site Web') || '',
      // Credentials API TEST (section "PARAMÈTRES D'ACCÈS TEST FOURNIS")
      apiUser      : findVal("Nom d'utilisateur API") || findVal('Nom utilisateur API') || findVal('API_USER'),
      apiPwd       : findVal('Mot de passe API')      || findVal('Mot de passe')         || findVal('API_PWD'),
      apiUrl       : findVal('URL API')               || findVal('Endpoint API'),
    };
  } else {
    result.anomalies.push({ type: 'error', msg: 'Feuille "Informations" introuvable.' });
  }

  // Détection modèle vierge
  result.isBlankTemplate = !result.merchant.raisonSociale
    || result.merchant.raisonSociale === '{{RAISON_SOCIALE}}'
    || result.merchant.raisonSociale === '';

  if (result.isBlankTemplate) return result;

  // ── Feuille Cas de Test ──────────────────────────────
  const wsTests = wb.Sheets['Cas de Test'];
  if (wsTests) {
    const data = XLSX.utils.sheet_to_json(wsTests, { header: 1, defval: '' });

    for (let i = 3; i <= 10; i++) {
      const row = data[i];
      if (!row) continue;
      const tcId     = String(row[1] || '').trim();
      const name     = String(row[2] || '').trim();
      const resultat = String(row[5] || '').trim().toUpperCase();
      const jsonResp = String(row[6] || '').trim();
      const comments = String(row[7] || '').trim();
      if (!tcId) continue;

      const isCritical       = CRITICAL_IDS.includes(tcId);
      const normalizedResult = normalizeResult(resultat);

      let parsedJson = null, jsonValid = false, jsonErrors = [];
      if (tcId !== 'CTP-02' && jsonResp && !jsonResp.startsWith('←')) {
        try {
          parsedJson = JSON.parse(jsonResp);
          jsonValid  = true;
          jsonErrors = validateJsonResponse(tcId, parsedJson);
        } catch {
          jsonErrors = ['Réponse JSON invalide ou mal formatée'];
        }
      }

      result.cases.push({
        tcId, name: name || CASE_NAMES[tcId] || tcId,
        resultat: resultat || 'EN ATTENTE', normalizedResult,
        jsonResp, parsedJson, jsonValid, jsonErrors,
        comments, isCritical,
        priority: PRIORITY[tcId] || 'Normale',
        // Extraire orderId depuis CTP-01 pour usage dans CTP-01 verify
        orderId: tcId === 'CTP-01' && parsedJson?.orderId ? parsedJson.orderId : undefined,
      });

      if (normalizedResult === 'pass')     { result.pass++; if (isCritical) result.criticalPass++; }
      else if (normalizedResult === 'fail')  result.fail++;
      else                                   result.pending++;
      result.total++;
    }

    // Cas critiques manquants
    const foundIds = result.cases.map(c => c.tcId);
    CRITICAL_IDS.forEach(id => {
      if (!foundIds.includes(id))
        result.anomalies.push({ type: 'error', msg: `Cas ${id} manquant — cas obligatoire.` });
    });
    result.cases.filter(c => c.isCritical && c.normalizedResult !== 'pass').forEach(c => {
      const label = c.normalizedResult === 'fail' ? 'ÉCHOUÉ' : 'non renseigné';
      result.anomalies.push({
        type: c.normalizedResult === 'fail' ? 'error' : 'warn',
        msg : `${c.tcId} (${c.name}) est ${label} — cas critique obligatoire.`,
      });
    });
  } else {
    result.anomalies.push({ type: 'error', msg: 'Feuille "Cas de Test" introuvable.' });
  }

  // ── Verdict ──────────────────────────────────────────
  const allCriticalPass = result.criticalPass === CRITICAL_IDS.length;
  if (allCriticalPass && result.fail === 0 && result.pending === 0)
    result.verdict = 'approved';
  else if (result.fail > 0 || (result.criticalPass < CRITICAL_IDS.length && result.total > 0))
    result.verdict = 'refused';
  else
    result.verdict = 'pending';

  return result;
}
