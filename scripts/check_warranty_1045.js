const pool = require('../database/db');

async function main() {
  const c = await pool.query(
    `SELECT cust_id, comp_name, consumer, sol_warranty, inv_warranty, po_date
     FROM customer WHERE comp_name ILIKE '%ashwi%'`
  );
  console.table(c.rows);
  for (const row of c.rows) {
    const m = await pool.query(
      `SELECT id, customer_id, installation_date_date, comp_name
       FROM customer_mseb
       WHERE customer_id = $1 OR TRIM(LOWER(comp_name)) = TRIM(LOWER($2))`,
      [row.cust_id, row.comp_name]
    );
    console.log(row.cust_id, row.comp_name, 'mseb rows:', m.rows.length, m.rows[0] || 'none');
  }
  const msebAll = await pool.query(
    `SELECT id, customer_id, comp_name, installation_date_date FROM customer_mseb WHERE comp_name ILIKE '%ashwi%'`
  );
  console.log('mseb by name ashwi:', msebAll.rows);
}

main().finally(() => process.exit(0));
