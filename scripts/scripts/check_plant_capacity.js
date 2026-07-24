const pool = require('../database/db');

async function main() {
  const cols = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer'
      AND (column_name ILIKE '%plant%' OR column_name ILIKE '%capacity%')
    ORDER BY column_name
  `);
  console.log('capacity-related columns:', cols.rows);

  const rows = await pool.query(`
    SELECT cust_id, comp_name, consumer, plant_capacity
    FROM customer
    ORDER BY cust_id DESC
    LIMIT 10
  `);
  console.log('sample customers:', JSON.stringify(rows.rows, null, 2));

  const named = await pool.query(`
    SELECT cust_id, comp_name, consumer, plant_capacity, new_customer_id
    FROM customer
    WHERE comp_name ILIKE '%ashwi%' OR comp_name ILIKE '%high%court%'
    ORDER BY cust_id DESC
  `);
  console.log('named projects:', JSON.stringify(named.rows, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
