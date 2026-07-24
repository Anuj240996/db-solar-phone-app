/**
 * Sync firereport_servicerequest.mobilenumber from customer.phone
 * so Django portal (Services In Process / View) shows customer table numbers.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

(async () => {
  const result = await pool.query(`
    UPDATE firereport_servicerequest sr
    SET mobilenumber = c.phone
    FROM (
      SELECT DISTINCT ON (sr2.id)
        sr2.id AS service_id,
        cust.phone
      FROM firereport_servicerequest sr2
      INNER JOIN customer cust
        ON cust.new_customer_id = COALESCE(sr2.account_id, sr2.assignby)
      WHERE NULLIF(TRIM(cust.phone), '') IS NOT NULL
      ORDER BY sr2.id, cust.cust_id DESC
    ) c
    WHERE sr.id = c.service_id
      AND TRIM(COALESCE(sr.mobilenumber, '')) IS DISTINCT FROM TRIM(c.phone)
    RETURNING sr.id, sr.fullname, sr.mobilenumber
  `);
  console.log('Updated rows:', result.rowCount);
  console.log(result.rows);

  const check = await pool.query(`
    SELECT id, fullname, mobilenumber FROM firereport_servicerequest WHERE id IN (4,5) ORDER BY id
  `);
  console.log('After update id 4/5:', check.rows);
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
