const { Pool } = require('pg');
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
});

async function main() {
  const orgs = await pool.query(
    `SELECT id, name FROM core_organization ORDER BY id LIMIT 10`
  ).catch(async (e) => {
    console.log('core_organization fail', e.message);
    return pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%organ%'`
    );
  });
  console.log('ORGS', orgs.rows);

  const sources = await pool.query(
    `SELECT id, name FROM crm_leads_leadsource ORDER BY id LIMIT 20`
  ).catch((e) => ({ rows: [{ err: e.message }] }));
  console.log('SOURCES', sources.rows);

  const campaigns = await pool.query(
    `SELECT id, name FROM crm_leads_campaign ORDER BY id LIMIT 10`
  ).catch((e) => ({ rows: [{ err: e.message }] }));
  console.log('CAMPAIGNS', campaigns.rows);

  const sample = await pool.query(`SELECT * FROM crm_leads_lead LIMIT 1`);
  console.log('SAMPLE CRM LEAD keys', sample.rows[0] ? Object.keys(sample.rows[0]) : null);
  console.log('SAMPLE CRM LEAD', sample.rows[0]);

  const ll = await pool.query(`SELECT id, name, phone, email, stage, status, created_at FROM leads_lead ORDER BY id DESC LIMIT 5`);
  console.log('RECENT leads_lead', ll.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
