require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

(async () => {
  const mismatch = await pool.query(`
    SELECT sr.id, sr.fullname, sr.mobilenumber AS stored_mobile,
           c.phone AS customer_phone, c.cust_id, c.comp_name, sr.account_id
    FROM firereport_servicerequest sr
    LEFT JOIN LATERAL (
      SELECT phone, cust_id, comp_name
      FROM customer
      WHERE new_customer_id = COALESCE(sr.account_id, sr.assignby)
      ORDER BY cust_id DESC
      LIMIT 1
    ) c ON true
    WHERE c.phone IS NOT NULL
      AND NULLIF(TRIM(c.phone), '') IS NOT NULL
      AND TRIM(COALESCE(sr.mobilenumber, '')) IS DISTINCT FROM TRIM(c.phone)
    ORDER BY sr.id
  `);
  console.log('mismatched services count:', mismatch.rows.length);
  console.log(mismatch.rows);

  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
