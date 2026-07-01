require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const urls = [
  process.env.DATABASE_URL,
  'postgresql://admin:root@localhost:5432/db_solar_v2',
  'postgresql://admin:root@localhost:5432/db_solar',
];

(async () => {
  for (const u of urls) {
    if (!u) continue;
    const safe = u.replace(/:([^:@]+)@/, ':***@');
    const pool = new Pool({ connectionString: u, ssl: false });
    try {
      const db = await pool.query('SELECT current_database() AS name');
      const tables = await pool.query(
        "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'"
      );
      console.log('OK', safe, '->', db.rows[0].name, 'public tables:', tables.rows[0].n);
    } catch (e) {
      console.log('FAIL', safe, '->', e.message);
    }
    await pool.end();
  }
})();
