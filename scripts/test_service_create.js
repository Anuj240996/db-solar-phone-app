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

  const cnt2 = await pool.query('SELECT COUNT(*)::int n, MIN(id) min, MAX(id) max FROM firereport_servicerequest');
  console.log('service rows:', cnt2.rows[0]);

  // Simulate OLD VPS 1.2.1 insert (MAX id + 1)
  try {
    const maxId = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM firereport_servicerequest`);
    const nextId = maxId.rows[0].next_id;
    await pool.query('BEGIN');
    await pool.query(
      `INSERT INTO firereport_servicerequest
        (id, fullname, mobilenumber, "Location", message, service_type, additional_notes, warranty_type, status, postingdate, account_id, assignby, app_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [nextId, 'Gamma Engineering Pvt Ltd', '9890652899', 'Waluj', 'Inverter service / fault', 'Inverter service / fault', 'ff', 'Annual maintenance service (AMC)', 'Pending', new Date(), 30, 30, null]
    );
    console.log('OLD style insert OK id:', nextId);
    await pool.query('ROLLBACK');
  } catch (e) {
    await pool.query('ROLLBACK');
    console.log('OLD style insert FAIL:', e.message);
  }

  const triggers = await pool.query(
    `SELECT tgname FROM pg_trigger WHERE tgrelid = 'firereport_servicerequest'::regclass AND NOT tgisinternal`
  );
  console.log('triggers:', triggers.rows.map((r) => r.tgname));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
