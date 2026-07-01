const { Pool } = require('pg');
const {
  fetchCustomerResultForCustomer,
  computeProjectStatusFromResult,
} = require('../utils/customerResult');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
});

async function main() {
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE '%user%'
     ORDER BY 1`
  );
  console.log('user tables:', tables.rows.map((r) => r.table_name));

  const cr = await pool.query(
    `SELECT id, consumer, inspection_report::text, consumer_id_id
     FROM customer_result WHERE consumer_id_id = 1014`
  );
  console.log('customer_result 1014:', cr.rows);

  const customer = (
    await pool.query('SELECT * FROM customer WHERE cust_id = 1014')
  ).rows[0];
  const row = await fetchCustomerResultForCustomer(customer);
  console.log('computed status:', computeProjectStatusFromResult(row));
}

main()
  .catch((e) => console.error(e))
  .finally(() => pool.end());
