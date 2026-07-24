const { Pool } = require('pg');
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
});

async function main() {
  const cols = await pool.query(`
    SELECT column_name, is_nullable, column_default, data_type
    FROM information_schema.columns
    WHERE table_name='crm_leads_leadsource'
    ORDER BY ordinal_position
  `);
  console.log(cols.rows);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
