// scripts/test-api.js — Tests complets de l'API v2
// Usage : node scripts/test-api.js
require('dotenv').config();

const http = require('http');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
let accessToken = null;
let passed = 0, failed = 0;
const results = [];

// ── Helper HTTP ────────────────────────────────────────────
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const data    = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token)  headers['Authorization'] = `Bearer ${token}`;
    if (data)   headers['Content-Length'] = Buffer.byteLength(data);

    const url  = new URL(BASE + path);
    const opts = {
      hostname: url.hostname, port: url.port || 80,
      path: url.pathname + url.search,
      method, headers
    };

    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', err => {
      // Afficher l'erreur réseau clairement
      console.error(`\n  ⚠️  Erreur réseau sur ${method} ${path}: ${err.message}`);
      console.error(`     (Vérifiez que le serveur tourne sur ${BASE})\n`);
      reject(err);
    });
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`Timeout — le serveur ne répond pas sur ${BASE}`));
    });
    if (data) req.write(data);
    req.end();
  });
}

// ── Assertion ──────────────────────────────────────────────
function assert(label, condition, details = '') {
  const ok   = !!condition;
  const icon = ok ? '✅' : '❌';
  console.log(`  ${icon} ${label}${details ? ' — ' + details : ''}`);
  ok ? passed++ : failed++;
  results.push({ label, ok, details });
  return ok;
}

// ── Tests ──────────────────────────────────────────────────
async function run() {
  console.log('\n🧪 ClicToPay API v2 — Tests\n' + '═'.repeat(50));
  console.log(`\n🔌 Cible : ${BASE}\n`);

  // ── 0. Vérification connexion ──────────────────────────
  console.log('📋 0. Vérification connexion au serveur');
  try {
    const r = await request('GET', '/api/health');
    console.log(`  ✅ Serveur répond — HTTP ${r.status}`);
  } catch(e) {
    console.log(`  ❌ Serveur inaccessible : ${e.message}`);
    console.log('\n  💡 Solutions :');
    console.log('     1. Vérifiez que node server-v2.js tourne dans un autre terminal');
    console.log('     2. Vérifiez que PORT dans .env correspond (actuel: ' + (process.env.PORT||'3000') + ')');
    console.log('     3. Essayez : curl http://localhost:3000/api/health\n');
    process.exit(1);
  }

  // ── 1. Health check ────────────────────────────────────
  console.log('\n📋 1. Health check');
  try {
    const r = await request('GET', '/api/health');
    assert('HTTP 200',          r.status === 200);
    assert('status: ok',        r.body?.status === 'ok');
    assert('version: 2.0',      r.body?.version === '2.0');
    assert('PostgreSQL up',     r.body?.services?.postgresql === 'up', r.body?.services?.postgresql);
    assert('Oracle BPC',        r.body?.services?.oracle_bpc  === 'up', r.body?.services?.oracle_bpc);
    assert('SQL Server',        r.body?.services?.sql_server  === 'up', r.body?.services?.sql_server);
    console.log('  Services détectés:', JSON.stringify(r.body?.services || {}));
  } catch(e) { assert('Health check accessible', false, e.message); }

  // ── 2. Auth — Erreurs attendues ────────────────────────
  console.log('\n📋 2. Auth — Accès sans token');
  try {
    const r = await request('GET', '/api/banks');
    assert('401 sans token',    r.status === 401);
    assert('Message erreur',    r.body?.error);
  } catch(e) { assert('Route protégée', false, e.message); }

  // ── 3. Login — mauvais mot de passe ───────────────────
  console.log('\n📋 3. Login — identifiants invalides');
  try {
    const r = await request('POST', '/api/auth/login', {
      email: 'admin@clictopay.com', password: 'mauvais_mdp'
    });
    assert('401 refusé',        r.status === 401);
    assert('Pas de token',      !r.body?.accessToken);
  } catch(e) { assert('Login invalide géré', false, e.message); }

  // ── 4. Login — valide ─────────────────────────────────
  console.log('\n📋 4. Login — identifiants valides');
  try {
    const r = await request('POST', '/api/auth/login', {
      email   : 'admin@clictopay.com',
      password: process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@CTP2026'
    });
    assert('HTTP 200',          r.status === 200,         `status=${r.status}`);
    assert('accessToken',       !!r.body?.accessToken,    r.body?.error || 'OK');
    assert('refreshToken',      !!r.body?.refreshToken);
    assert('user.role = admin', r.body?.user?.role === 'admin', r.body?.user?.role);
    assert('user.email',        !!r.body?.user?.email);

    if (r.body?.accessToken) {
      accessToken = r.body.accessToken;
      console.log('  🔑 Token obtenu — utilisé pour les tests suivants');
    }
  } catch(e) { assert('Login valide', false, e.message); }

  if (!accessToken) {
    console.log('\n⚠️  Impossible de continuer sans token — vérifiez que seed-admin.js a été exécuté\n');
    printResults(); return;
  }

  // ── 5. /api/auth/me ───────────────────────────────────
  console.log('\n📋 5. GET /api/auth/me');
  try {
    const r = await request('GET', '/api/auth/me', null, accessToken);
    assert('HTTP 200',          r.status === 200);
    assert('email correct',     r.body?.user?.email === 'admin@clictopay.com');
    assert('role correct',      r.body?.user?.role  === 'admin');
  } catch(e) { assert('/auth/me accessible', false, e.message); }

  // ── 6. Banques ────────────────────────────────────────
  console.log('\n📋 6. GET /api/banks');
  try {
    const r = await request('GET', '/api/banks', null, accessToken);
    assert('HTTP 200',          r.status === 200);
    assert('success: true',     r.body?.success === true);
    assert('16 banques',        r.body?.banks?.length === 16, `${r.body?.banks?.length} banque(s)`);
    if (r.body?.banks?.length) {
      const first = r.body.banks[0];
      assert('Format banque OK', first.code && first.name && first.email,
        `code=${first.code} name=${first.name}`);
    }
  } catch(e) { assert('Banques accessible', false, e.message); }

  // ── 7. Banque par code ────────────────────────────────
  console.log('\n📋 7. GET /api/banks/by-code?code=0520801267');
  try {
    const r = await request('GET', '/api/banks/by-code?code=0520801267', null, accessToken);
    assert('HTTP 200',          r.status === 200);
    assert('Banque détectée',   !!r.body?.bank, r.body?.bank ? r.body.bank.name : 'null');
    if (r.body?.bank) {
      assert('Code 05 = BT',    r.body.bank.code === '05', r.body.bank.name);
    }
  } catch(e) { assert('By-code accessible', false, e.message); }

  // ── 8. Colonnes + Ping + Transactions Oracle ─────────────
  console.log('\n📋 8. POST /api/transactions (Oracle BPC)');
  try {
    // Colonnes disponibles
    const colR = await request('GET', '/api/transactions/columns', null, accessToken);
    if (colR.body?.columns?.length) {
      const names = colR.body.columns.map(c => c.COLUMN_NAME);
      console.log(`  📋 Colonnes disponibles (${names.length}) :`);
      for (let i = 0; i < names.length; i += 6)
        console.log(`     ${names.slice(i, i+6).join(', ')}`);
    }

    // Ping simple — COUNT(*)
    const ping = await request('GET', '/api/transactions/ping', null, accessToken);
    assert('Ping Oracle OK',   ping.status === 200 && ping.body?.success, ping.body?.error || `total=${ping.body?.total}`);
    if (ping.body?.total !== undefined)
      console.log(`  📊 Total lignes BPCTRANSACTIONS : ${ping.body.total.toLocaleString()}`);

    // Test PAN masquage sur 1 ligne
    const panR = await request('GET', '/api/transactions/test-pan', null, accessToken);
    assert('Masquage PAN OK',  panR.status === 200 && panR.body?.success, panR.body?.error || 'OK');
    if (panR.body?.sample?.length)
      console.log(`  🔒 Exemple carte masquée : ${panR.body.sample[0].CARTE_MASQUEE}`);

    // Requête paginée complète
    const r = await request('POST', '/api/transactions', { page: 1, pageSize: 5 }, accessToken);
    assert('HTTP 200',         r.status === 200,             `status=${r.status}`);
    assert('success: true',    r.body?.success === true,     r.body?.error || 'OK');
    assert('total présent',    r.body?.total !== undefined,  `total=${r.body?.total}`);
    assert('data est tableau', Array.isArray(r.body?.data),  `data=${typeof r.body?.data}`);
    if (r.body?.data?.length)
      console.log(`  ✅ ${r.body.total} transactions — colonnes : ${Object.keys(r.body.data[0]).join(', ')}`);
  } catch(e) { assert('Transactions accessible', false, e.message); }

  // ── 9. Switch dropdowns ───────────────────────────────
  console.log('\n📋 9. GET /api/switch/dropdowns');
  try {
    const r = await request('GET', '/api/switch/dropdowns', null, accessToken);
    assert('HTTP 200',          r.status === 200);
    assert('success: true',     r.body?.success === true,  r.body?.error || 'OK');
    assert('fsp présent',       Array.isArray(r.body?.fsp));
    assert('etat présent',      Array.isArray(r.body?.etat));
    console.log(`  FSP: ${r.body?.fsp?.length} | Etats: ${r.body?.etat?.length} | Facturiers: ${r.body?.facturier?.length}`);
  } catch(e) { assert('Switch dropdowns', false, e.message); }

  // ── 10. Marchands PROD ───────────────────────────────
  console.log('\n📋 10. GET /api/merchants/prod');
  try {
    const r = await request('GET', '/api/merchants/prod', null, accessToken);
    assert('HTTP 200',          r.status === 200);
    assert('success: true',     r.body?.success === true,  r.body?.error || 'OK');
    assert('count présent',     r.body?.count !== undefined, `${r.body?.count} marchands`);
    console.log(`  🏪 ${r.body?.count} marchands PROD`);
  } catch(e) { assert('Merchants PROD', false, e.message); }

  // ── 11. Merchants TEST ───────────────────────────────
  console.log('\n📋 11. GET /api/merchants/test');
  try {
    const r = await request('GET', '/api/merchants/test', null, accessToken);
    assert('HTTP 200',          r.status === 200);
    assert('success: true',     r.body?.success === true,  r.body?.error || 'OK');
    console.log(`  🧪 ${r.body?.count} marchands TEST`);
  } catch(e) { assert('Merchants TEST', false, e.message); }

  // ── 12. Validations ──────────────────────────────────
  console.log('\n📋 12. GET /api/validations');
  try {
    const r = await request('GET', '/api/validations', null, accessToken);
    assert('HTTP 200',          r.status === 200);
    assert('success: true',     r.body?.success === true);
    assert('validations array', Array.isArray(r.body?.validations));
    console.log(`  📋 ${r.body?.total || 0} validation(s) en base`);
  } catch(e) { assert('Validations accessible', false, e.message); }

  // ── 13. Tracking ─────────────────────────────────────
  console.log('\n📋 13. GET /api/tracking');
  try {
    const r = await request('GET', '/api/tracking', null, accessToken);
    assert('HTTP 200',          r.status === 200);
    assert('success: true',     r.body?.success === true);
    console.log(`  📦 ${r.body?.merchants?.length || 0} dossier(s) en suivi`);
  } catch(e) { assert('Tracking accessible', false, e.message); }

  // ── 14. SMTP ─────────────────────────────────────────
  console.log('\n📋 14. GET /api/merchants/test-smtp');
  try {
    const r = await request('GET', '/api/merchants/test-smtp', null, accessToken);
    assert('HTTP 200',          r.status === 200);
    assert('SMTP OK',           r.body?.success === true, r.body?.error || r.body?.message || '');
  } catch(e) { assert('SMTP accessible', false, e.message); }

  // ── 15. Refresh token ────────────────────────────────
  console.log('\n📋 15. Token expiration — route avec mauvais token');
  try {
    const r = await request('GET', '/api/banks', null, 'token_invalide_test');
    assert('401 token invalide', r.status === 401);
    assert('Erreur explicite',   r.body?.error);
  } catch(e) { assert('Token invalide géré', false, e.message); }

  printResults();
}

function printResults() {
  const total = passed + failed;
  const pct   = total ? Math.round(passed / total * 100) : 0;
  console.log('\n' + '═'.repeat(50));
  console.log(`\n📊 RÉSULTATS : ${passed}/${total} tests passés (${pct}%)\n`);
  if (failed > 0) {
    console.log('❌ Tests échoués :');
    results.filter(r => !r.ok).forEach(r => console.log(`   • ${r.label}${r.details ? ' — ' + r.details : ''}`));
  } else {
    console.log('✅ Tous les tests sont passés — API v2 opérationnelle !');
  }
  console.log();
}

run().catch(err => {
  console.error('\n❌ Erreur fatale:', err.message);
  process.exit(1);
});
