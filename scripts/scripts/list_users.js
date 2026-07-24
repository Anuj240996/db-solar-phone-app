require('dotenv').config();
const pool = require('../database/db');

async function main() {
  console.log('DB URL host:', (process.env.DATABASE_URL || '').replace(/:[^:@]+@/, ':***@'));
  const db = await pool.query('SELECT current_database()');
  console.log('database:', db.rows[0].current_database);

  for (const t of ['user_app', 'auth_user', 'users']) {
    try {
      const c = await pool.query(`SELECT COUNT(*)::int n FROM ${t}`);
      console.log(t, 'count', c.rows[0].n);
      const sample = await pool.query(`SELECT * FROM ${t} LIMIT 2`);
      console.log(t, 'sample', sample.rows);
    } catch (e) {
      console.log(t, 'error', e.message);
    }
  }
  await pool.end();
}

main();
