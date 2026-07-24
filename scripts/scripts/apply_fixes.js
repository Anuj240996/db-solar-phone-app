require('dotenv').config();
const { ensureLeadsLeadSchema } = require('../utils/ensureLeadsLeadSchema');
const { ensureSupportSchema } = require('../utils/ensureSupportSchema');
const pool = require('../database/db');

async function main() {
  await ensureLeadsLeadSchema();
  console.log('leads_lead schema OK');

  await ensureSupportSchema();
  console.log('app_support_queries schema OK');

  await pool.query(
    `ALTER TABLE firereport_firereport ALTER COLUMN assignby DROP NOT NULL`
  ).catch(() => {});

  try {
    await pool.query(`
      ALTER TABLE support_queries DROP CONSTRAINT IF EXISTS support_queries_user_id_fkey
    `);
    await pool.query(`
      ALTER TABLE support_queries ALTER COLUMN user_id TYPE BIGINT USING NULL
    `);
    console.log('support_queries.user_id BIGINT OK');
  } catch (e) {
    console.warn('support_queries migration:', e.message);
  }

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='leads_lead' AND column_name != 'id'`
  );
  console.log('leads_lead insertable columns:', cols.rows.length);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
