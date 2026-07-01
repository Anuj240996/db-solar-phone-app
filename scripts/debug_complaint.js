require('dotenv').config();
const pool = require('../database/db');

async function main() {
  const c = await pool.query(`
    SELECT cust_id, comp_name, new_customer_id, phone, city
    FROM customer WHERE new_customer_id IS NOT NULL
    ORDER BY cust_id DESC LIMIT 8
  `);
  console.log('customers:', c.rows);

  const links = await pool.query('SELECT COUNT(*)::int n FROM app_auth_links');
  console.log('app_auth_links count:', links.rows[0].n);

  await pool.end();
}

main();
