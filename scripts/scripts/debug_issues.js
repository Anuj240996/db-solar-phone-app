require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

async function main() {
  const t = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name LIKE '%token%' ORDER BY table_name`
  );
  console.log('token tables:', t.rows.map((r) => r.table_name).join(', '));

  const sample = await pool.query(`SELECT key, user_id, length(key) AS len FROM authtoken_token LIMIT 5`);
  console.log('sample tokens:', sample.rows);

  const fk = await pool.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint WHERE conrelid = 'firereport_servicerequest'::regclass`
  );
  console.log('FKs:', fk.rows.map((r) => r.def).join('; '));

  const sr = await pool.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_name='firereport_servicerequest' ORDER BY ordinal_position`
  );
  console.log('service cols:', sr.rows.map((r) => `${r.column_name}(${r.is_nullable})`).join(', '));

  // Test insert shape
  try {
    const maxId = await pool.query(`SELECT COALESCE(MAX(id),0)+1 AS n FROM firereport_servicerequest`);
    const id = maxId.rows[0].n;
    await pool.query('BEGIN');
    await pool.query(
      `INSERT INTO firereport_servicerequest
        (id, fullname, mobilenumber, "Location", message, service_type, additional_notes, warranty_type, status, postingdate, account_id, assignby, app_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, 'Test', '9', 'Pune', 'Net meter issue', 'Net meter issue', 'notes', 'Promotional warranty', 'Pending', new Date().toISOString(), 65, 65, null]
    );
    await pool.query('ROLLBACK');
    console.log('test insert: OK');
  } catch (e) {
    console.log('test insert FAIL:', e.message);
  }

  const cnt = await pool.query(`SELECT COUNT(*)::int AS n, MAX(id) AS max_id FROM firereport_servicerequest`);
  console.log('service rows:', cnt.rows[0]);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
