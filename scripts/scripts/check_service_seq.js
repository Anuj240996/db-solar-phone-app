require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

async function main() {
  const stats = await pool.query(`
    SELECT COUNT(*)::int AS n, MIN(id) AS min_id, MAX(id) AS max_id FROM firereport_servicerequest
  `);
  const seq = await pool.query(
    `SELECT last_value, is_called FROM firereport_servicerequest_id_seq`
  );
  console.log('table:', stats.rows[0]);
  console.log('sequence:', seq.rows[0]);

  const db = await pool.query('SELECT current_database() AS db');
  console.log('database:', db.rows[0].db);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
