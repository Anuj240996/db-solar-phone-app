const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
});

async function main() {
  const cust = await pool.query(
    `SELECT cust_id, consumer, comp_name, new_customer_id
     FROM customer
     WHERE comp_name ILIKE '%Pradip Dhote%'
        OR consumer ILIKE '%Pradip Dhote%'
     ORDER BY cust_id`
  );
  console.log('=== customer rows ===');
  console.log(JSON.stringify(cust.rows, null, 2));

  for (const c of cust.rows) {
    const cr = await pool.query(
      `SELECT id, consumer,
              solar_panel::text AS solar_panel,
              inverter::text AS inverter,
              net_meter::text AS net_meter,
              mseb::text AS mseb,
              inspection_report::text AS inspection_report,
              consumer_id_id
       FROM customer_result
       WHERE consumer_id_id = $1
          OR TRIM(consumer::text) = TRIM($2::text)
       ORDER BY id DESC
       LIMIT 5`,
      [c.cust_id, c.consumer || c.comp_name]
    );
    console.log(`--- customer_result for cust_id ${c.cust_id} ---`);
    console.log(JSON.stringify(cr.rows, null, 2));
  }
}

main()
  .catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
  })
  .finally(() => pool.end());
