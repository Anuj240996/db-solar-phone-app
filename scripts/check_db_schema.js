require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

async function main() {
  const cols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='leads_lead' ORDER BY ordinal_position`
  );
  console.log('leads_lead columns:', cols.rows.length);
  console.log(cols.rows.map((r) => r.column_name).join(', '));

  const sup = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='app_support_queries' ORDER BY ordinal_position`
  );
  console.log('app_support_queries:', sup.rows.map((r) => r.column_name).join(', ') || 'MISSING');

  const tables = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%lead%'`
  );
  console.log('lead tables:', tables.rows.map((r) => r.tablename).join(', '));

  const view = await pool.query(
    `SELECT table_type FROM information_schema.tables WHERE table_schema='public' AND table_name='leads_lead'`
  );
  console.log('leads_lead type:', view.rows[0]?.table_type || 'missing');

  const ash = await pool.query(
    `SELECT cust_id, comp_name, new_customer_id FROM customer WHERE comp_name ILIKE '%ashwi%' LIMIT 5`
  );
  console.log('ashwi customers:', ash.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
