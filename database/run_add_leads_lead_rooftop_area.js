const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

async function run() {
  const sqlPath = path.join(__dirname, 'add_leads_lead_rooftop_area.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('Adding rooftop_area and rooftop_area_unit to leads_lead...');
    await pool.query(sql);
    console.log('Done. leads_lead now has rooftop_area and rooftop_area_unit columns.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
