const { Pool } = require('pg');
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
});

async function main() {
  const faqCols = await pool.query(`
    SELECT column_name, column_default, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_name='faqs' ORDER BY ordinal_position
  `);
  console.log('FAQ COLS', faqCols.rows);

  const orgCols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='core_organization' ORDER BY ordinal_position
  `);
  console.log('ORG COLS', orgCols.rows.map((r) => r.column_name));
  const orgs = await pool.query('SELECT * FROM core_organization LIMIT 5');
  console.log('ORGS', orgs.rows);

  const stages = await pool.query(`
    SELECT DISTINCT stage, score FROM crm_leads_lead LIMIT 20
  `);
  console.log('STAGES/SCORES', stages.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
