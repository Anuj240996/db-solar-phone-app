require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

async function main() {
  const gamma = await pool.query(
    `SELECT cust_id, comp_name, new_customer_id, phone, city
     FROM customer WHERE comp_name ILIKE '%gamma%waluj%' OR comp_name ILIKE '%gamma engineering%' LIMIT 5`
  );
  console.log('gamma customers:', gamma.rows);

  const cols = await pool.query(
    `SELECT column_name, is_nullable, column_default, data_type
     FROM information_schema.columns
     WHERE table_name = 'firereport_servicerequest' ORDER BY ordinal_position`
  );
  console.log('columns:', cols.rows.map((r) => `${r.column_name}(${r.is_nullable},${r.data_type})`).join('\n  '));

  const cnt = await pool.query('SELECT COUNT(*)::int n, MAX(id) max_id FROM firereport_servicerequest');
  console.log('rows:', cnt.rows[0]);

  const seq = await pool.query(`SELECT last_value, is_called FROM firereport_servicerequest_id_seq`);
  console.log('sequence:', seq.rows[0]);

  if (gamma.rows.length) {
    const c = gamma.rows[0];
    const authId = parseInt(c.new_customer_id, 10);
    try {
      await pool.query('BEGIN');
      const r = await pool.query(
        `INSERT INTO firereport_servicerequest
          (fullname, mobilenumber, "Location", message, service_type, additional_notes, warranty_type, status, postingdate, account_id, assignby, app_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          c.comp_name,
          c.phone || '0',
          c.city || '',
          'Annual maintenance service (AMC)',
          'Annual maintenance service (AMC)',
          'chh',
          'Promotional warranty',
          'Pending',
          new Date().toISOString(),
          authId,
          authId,
          null,
        ]
      );
      console.log('insert OK id:', r.rows[0].id);
      await pool.query('ROLLBACK');
    } catch (e) {
      await pool.query('ROLLBACK');
      console.log('insert FAIL:', e.message, e.detail || '');
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
