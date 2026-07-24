require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');
const { fetchCustomerResultForCustomer } = require('../utils/customerResult');

async function main() {
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'customer_result' ORDER BY ordinal_position
  `);
  console.log('customer_result columns:', cols.rows.map((r) => r.column_name).join(', '));

  const cust = await pool.query(
    `SELECT * FROM customer WHERE cust_id = 1045 LIMIT 1`
  );
  console.log('customer 1045:', cust.rows[0]);

  const cr = await fetchCustomerResultForCustomer(cust.rows[0]);
  console.log('fetchCustomerResultForCustomer:', cr);

  const authId = cust.rows[0]?.new_customer_id;
  const barcodes = await pool.query(
    `SELECT barcode_data, product_name, company_name, assignto_id
     FROM detect_barcodes_barcodeimage WHERE assignto_id = $1 LIMIT 5`,
    [authId]
  );
  console.log('barcodes:', barcodes.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
