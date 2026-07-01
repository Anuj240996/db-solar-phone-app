require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

async function main() {
  const cols = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'firereport_servicerequest'
    ORDER BY ordinal_position
  `);
  console.log('columns:');
  for (const c of cols.rows) {
    console.log(`  ${c.column_name} ${c.data_type} nullable=${c.is_nullable} default=${c.column_default}`);
  }

  const links = await pool.query(`
    SELECT l.*, c.cust_id, c.comp_name
    FROM app_auth_links l
    JOIN customer c ON c.new_customer_id::bigint = l.auth_user_id::bigint
    WHERE c.cust_id = 1011
  `);
  console.log('\napp_auth_links for gamma:', links.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
