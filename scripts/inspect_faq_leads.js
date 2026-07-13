const { Pool } = require('pg');
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
});

async function main() {
  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND (table_name ILIKE '%lead%' OR table_name ILIKE '%faq%' OR table_name ILIKE '%support%')
    ORDER BY 1
  `);
  console.log('TABLES:', tables.rows.map((r) => r.table_name));

  for (const name of ['crm_leads_lead', 'leads_lead', 'faqs']) {
    const cols = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [name]
    );
    console.log(`\n=== ${name} (${cols.rows.length} cols) ===`);
    for (const c of cols.rows) {
      console.log(`  ${c.column_name} | ${c.data_type} | null=${c.is_nullable}`);
    }
  }

  try {
    const faqCount = await pool.query('SELECT COUNT(*)::int AS n FROM faqs');
    console.log('\nFAQ_COUNT', faqCount.rows[0]);
    const sample = await pool.query('SELECT id, question FROM faqs ORDER BY id LIMIT 5');
    console.log('FAQ_SAMPLE', sample.rows);
  } catch (e) {
    console.log('FAQ error', e.message);
  }

  try {
    const crmCount = await pool.query('SELECT COUNT(*)::int AS n FROM crm_leads_lead');
    console.log('CRM_LEADS_COUNT', crmCount.rows[0]);
  } catch (e) {
    console.log('CRM count error', e.message);
  }

  try {
    const leadsCount = await pool.query('SELECT COUNT(*)::int AS n FROM leads_lead');
    console.log('LEADS_LEAD_COUNT', leadsCount.rows[0]);
  } catch (e) {
    console.log('leads_lead count error', e.message);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
