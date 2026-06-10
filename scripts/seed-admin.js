// scripts/seed-admin.js — Générer le hash bcrypt de l'admin et mettre à jour la BDD
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@CTP2026';

async function seedAdmin() {
  // ── Vérification des variables d'environnement ────────
  const cfg = {
    host    : process.env.PG_HOST     || 'localhost',
    port    : parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DATABASE || 'clictopay_db',
    user    : process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  };

  console.log('\n📋 Configuration PostgreSQL lue :');
  console.log(`   Host     : ${cfg.host}`);
  console.log(`   Port     : ${cfg.port}`);
  console.log(`   Database : ${cfg.database}`);
  console.log(`   User     : ${cfg.user     || '❌ PG_USER manquant dans .env'}`);
  console.log(`   Password : ${cfg.password ? '✓ défini' : '❌ PG_PASSWORD manquant dans .env'}\n`);

  if (!cfg.user || !cfg.password) {
    console.error('❌ Vérifiez votre fichier .env — PG_USER et PG_PASSWORD sont obligatoires.');
    console.error('   Exemple :');
    console.error('   PG_USER=postgres');
    console.error('   PG_PASSWORD=votre_mot_de_passe\n');
    process.exit(1);
  }

  const pool = new Pool(cfg);

  try {
    console.log('🔐 Génération du hash bcrypt (rounds=12)...');
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
    console.log('✅ Hash généré');

    await pool.query(
      `INSERT INTO users (nom, prenom, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      ['Admin', 'ClicToPay', 'admin@clictopay.com', hash, 'admin']
    );

    console.log('✅ Utilisateur admin créé/mis à jour');
    console.log(`   Email    : admin@clictopay.com`);
    console.log(`   Password : ${DEFAULT_PASSWORD}`);
    console.log('\n⚠️  IMPORTANT : Changez ce mot de passe après la première connexion !');
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  } finally {
    await pool.end();
  }
}

seedAdmin();
