require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

(async () => {
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'customer'
      AND (column_name ILIKE '%phone%' OR column_name ILIKE '%mobile%' OR column_name ILIKE '%contact%')
    ORDER BY 1
  `);
  console.log('customer phone-like cols:', cols.rows);

  const sr = await pool.query(`
    SELECT id, fullname, mobilenumber, account_id, assignby, app_user_id, "Location"
    FROM firereport_servicerequest
    WHERE id IN (4, 5)
    ORDER BY id
  `);
  console.log('services:', sr.rows);

  for (const r of sr.rows) {
    const byAuth = await pool.query(
      `SELECT cust_id, comp_name, phone, new_customer_id, consumer
       FROM customer
       WHERE new_customer_id = $1 OR new_customer_id = $2 OR new_customer_id = $3
       ORDER BY cust_id DESC LIMIT 5`,
      [r.assignby, r.account_id, r.app_user_id]
    );
    const byName = await pool.query(
      `SELECT cust_id, comp_name, phone, new_customer_id
       FROM customer
       WHERE LOWER(TRIM(comp_name)) LIKE LOWER($1)
       ORDER BY cust_id DESC LIMIT 5`,
      [`%${(r.fullname || '').split(' ')[0] || '___'}%`]
    );
    console.log('\n--- service', r.id, 'stored mobile:', r.mobilenumber);
    console.log('match by ids:', byAuth.rows);
    console.log('match by name:', byName.rows);
  }

  // Also check user_app / auth_user phones for comparison
  const ua = await pool.query(
    `SELECT id, email, phone FROM user_app WHERE phone IS NOT NULL ORDER BY id DESC LIMIT 10`
  );
  console.log('\nuser_app phones sample:', ua.rows);

  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
