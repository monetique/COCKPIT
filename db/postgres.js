// db/postgres.js — Pool de connexions PostgreSQL
const { Pool } = require('pg');

const pool = new Pool({
  host    : process.env.PG_HOST     || 'localhost',
  port    : parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'clictopay_db',
  user    : process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  max     : 10,          // connexions max dans le pool
  idleTimeoutMillis   : 30000,
  connectionTimeoutMillis: 5000,
  ssl     : process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

// Test de connexion au démarrage
pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL connecté');
    client.release();
  })
  .catch(err => {
    console.error('❌ PostgreSQL connexion échouée:', err.message);
  });

// Helper : exécuter une requête
async function query(sql, params) {
  const start = Date.now();
  try {
    const result = await pool.query(sql, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`⚠️ Requête lente (${duration}ms): ${sql.slice(0, 80)}`);
    }
    return result;
  } catch (err) {
    console.error('❌ Erreur requête PG:', err.message, '| SQL:', sql.slice(0, 80));
    throw err;
  }
}

// Helper : transaction
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
