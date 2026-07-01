const { Pool } = require('pg');
require('dotenv').config();

const dbSslEnv = (process.env.DB_SSL || '').toLowerCase();
const useSsl =
  dbSslEnv === 'true' ||
  dbSslEnv === '1' ||
  dbSslEnv === 'require' ||
  dbSslEnv === 'yes';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Do not force SSL just because NODE_ENV=production.
  // Some VPS/local Postgres setups do not support SSL.
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;

