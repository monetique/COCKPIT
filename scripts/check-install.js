// scripts/check-install.js — Vérifie que tous les fichiers v2 sont présents
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const REQUIRED = [
  // Racine
  'server-v2.js',
  'package.json',
  '.env',
  'CahierDesRecettes_TEMPLATE.xlsx',

  // Base de données
  'db/postgres.js',

  // Middleware
  'middleware/auth.js',
  'middleware/audit.js',

  // Config
  'config/mailer.js',
  'config/password.js',
  'config/email-logger.js',

  // Routes
  'routes/auth.js',
  'routes/transactions.js',
  'routes/switch.js',
  'routes/merchants.js',
  'routes/banks.js',
  'routes/validations.js',
  'routes/merchants-tracking.js',
];

console.log('\n🔍 Vérification des fichiers v2...\n');
let ok = 0, missing = 0;

for (const file of REQUIRED) {
  const fullPath = path.join(ROOT, file);
  const exists   = fs.existsSync(fullPath);
  if (exists) {
    console.log(`  ✅ ${file}`);
    ok++;
  } else {
    console.log(`  ❌ MANQUANT : ${file}`);
    missing++;
  }
}

console.log(`\n${missing === 0
  ? `✅ Tous les ${ok} fichiers sont présents — prêt à démarrer !`
  : `❌ ${missing} fichier(s) manquant(s) sur ${REQUIRED.length} — copiez-les avant de démarrer.`
}\n`);

if (missing > 0) {
  console.log('💡 Assurez-vous d\'avoir copié TOUTE la structure de dossiers :');
  console.log('   C:\\SMT_COCKPIT\\');
  console.log('   ├── db\\');
  console.log('   ├── middleware\\');
  console.log('   ├── config\\');
  console.log('   ├── routes\\');
  console.log('   └── scripts\\');
}
