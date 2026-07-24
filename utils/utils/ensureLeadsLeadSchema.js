const pool = require('../database/db');
const fs = require('fs');
const path = require('path');

let schemaReady = false;

async function ensureLeadsLeadSchema() {
  if (schemaReady) return;

  const createSql = fs.readFileSync(
    path.join(__dirname, '..', 'database', 'create_leads_lead_table.sql'),
    'utf8'
  );
  const addColsSql = fs.readFileSync(
    path.join(__dirname, '..', 'database', 'add_leads_lead_missing_columns.sql'),
    'utf8'
  );

  await pool.query(createSql);
  await pool.query(addColsSql);

  const extraCols = [
    ['phone', 'TEXT'],
    ['address', 'TEXT'],
    ['status', 'TEXT'],
    ['source', 'TEXT'],
    ['campaign', 'TEXT'],
    ['score', 'INTEGER DEFAULT 0'],
    ['tags', "TEXT DEFAULT '[]'"],
    ['probability', 'INTEGER DEFAULT 0'],
    ['next_followup', 'TIMESTAMP WITH TIME ZONE'],
    ['alternate_phone', 'TEXT'],
    ['notes', 'TEXT'],
    ['internal_notes', 'TEXT'],
    ['lost_reason', 'TEXT'],
    ['competitor', 'TEXT'],
    ['budget', 'INTEGER DEFAULT 0'],
    ['estimated_value', 'INTEGER DEFAULT 0'],
    ['rooftop_area', 'DOUBLE PRECISION'],
    ['rooftop_area_unit', "TEXT DEFAULT 'sq_m'"],
    ['latitude', 'DOUBLE PRECISION'],
    ['longitude', 'DOUBLE PRECISION'],
  ];

  for (const [col, type] of extraCols) {
    await pool.query(
      `ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS ${col} ${type}`
    );
  }

  const check = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name != 'id'`
  );
  if (check.rows[0].n === 0) {
    throw new Error('leads_lead has no data columns after migration');
  }

  schemaReady = true;
}

module.exports = { ensureLeadsLeadSchema };
