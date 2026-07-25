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

(function logDatabaseTarget() {
  const url = process.env.DATABASE_URL || '';
  if (!url) {
    console.error('ERROR: DATABASE_URL is not set. Phone app cannot start without Postgres.');
    return;
  }
  try {
    const u = new URL(url.replace(/^postgres(ql)?:/i, 'http:'));
    const host = u.hostname;
    const db = (u.pathname || '').replace(/^\//, '');
    console.log(`DATABASE_URL target: host=${host} port=${u.port || 5432} db=${db}`);
    if (host === 'db_solar_database' || host === 'db-solar-database') {
      console.warn(
        'WARNING: DB host looks stale. On EasyPanel use host "database" ' +
          '(example: postgresql://heramb:PASSWORD@database:5432/db_solar_v2)'
      );
    }
  } catch (e) {
    console.warn('Could not parse DATABASE_URL for logging:', e.message);
  }
})();

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;

