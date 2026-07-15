require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

(async () => {
  const c1 = await pool.query(
    `SELECT cust_id, comp_name, phone, new_customer_id FROM customer WHERE new_customer_id = 1 LIMIT 5`
  );
  console.log('customers with new_customer_id=1:', c1.rows);

  const nameJoin = await pool.query(`
    SELECT sr.id, sr.fullname AS stored_name, sr.mobilenumber,
           c_old.comp_name AS old_join_name, c_old.phone AS old_join_phone,
           c_new.comp_name AS new_join_name, c_new.phone AS new_join_phone
    FROM firereport_servicerequest sr
    LEFT JOIN LATERAL (
      SELECT comp_name, phone FROM customer
      WHERE new_customer_id = COALESCE(sr.assignby, sr.account_id)
      ORDER BY cust_id DESC LIMIT 1
    ) c_old ON true
    LEFT JOIN LATERAL (
      SELECT comp_name, phone FROM customer
      WHERE new_customer_id = COALESCE(sr.account_id, sr.assignby)
      ORDER BY cust_id DESC LIMIT 1
    ) c_new ON true
    WHERE sr.id IN (4,5)
  `);
  console.log(nameJoin.rows);
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
