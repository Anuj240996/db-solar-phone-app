require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ensureLeadsLeadSchema } = require('../utils/ensureLeadsLeadSchema');
const pool = require('../database/db');

async function main() {
  await ensureLeadsLeadSchema();
  const colsResult = await pool.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name != 'id'
     ORDER BY ordinal_position`
  );
  const existingColumns = colsResult.rows.map((r) => r.column_name);
  const nullableSet = new Set(
    colsResult.rows.filter((r) => r.is_nullable === 'YES').map((r) => r.column_name)
  );
  const now = new Date();
  const extraJson = JSON.stringify({});
  const allColumnValues = {
    name: 'Test Lead',
    property_type: 'residential',
    roof_type: 'flat',
    payment_mode: 'Finance',
    stage: 'new_app',
    status: 'new_enq',
    source: 'app',
    campaign: 'NA',
    score: 0,
    probability: 0,
    tags: '[]',
    extra: extraJson,
    created_at: now,
    updated_at: now,
    next_followup: now,
    phone: '9999999999',
    contact: '9999999999',
    email: 'test@test.com',
    address: 'NA',
    city: 'NA',
    state: 'NA',
    pincode: 'NA',
    sorting_address: 'NA',
    alternate_phone: 'NA',
    notes: 'NA',
    internal_notes: 'NA',
    lost_reason: 'NA',
    competitor: 'NA',
    budget: 0,
    estimated_value: 0,
    rooftop_area_unit: 'sq_m',
    user_app_id: null,
    assigned_to_id: null,
    lat: null,
    lng: null,
    latitude: null,
    longitude: null,
    rooftop_area: null,
    electricity_bill: '5000',
    monthly_consumption: null,
  };
  const numericColumns = new Set(['probability', 'score', 'budget', 'estimated_value']);
  const nullableIdColumns = new Set(['user_app_id', 'assigned_to_id']);
  const floatColumns = new Set(['lat', 'lng', 'latitude', 'longitude', 'rooftop_area']);
  const dateColumns = new Set([
    'created_at', 'updated_at', 'next_followup',
    'assigned_date', 'last_contacted', 'converted_at', 'lost_at',
  ]);
  const jsonColumns = new Set(['extra', 'tags']);

  const values = existingColumns.map((col) => {
    const v = allColumnValues[col];
    if (v !== undefined) return v;
    if (dateColumns.has(col)) return now;
    if (col === 'extra' || (jsonColumns.has(col) && col !== 'tags')) return extraJson;
    if (col === 'tags') return '[]';
    if (floatColumns.has(col) || nullableIdColumns.has(col)) return null;
    if (numericColumns.has(col)) return 0;
    if (nullableSet.has(col)) return null;
    return 'NA';
  });

  const placeholders = existingColumns.map((_, i) => `$${i + 1}`).join(', ');
  const columnList = existingColumns.join(', ');
  const r = await pool.query(
    `INSERT INTO leads_lead (${columnList}) VALUES (${placeholders}) RETURNING id`,
    values
  );
  console.log('leads insert OK id:', r.rows[0].id);
  await pool.query('DELETE FROM leads_lead WHERE id = $1', [r.rows[0].id]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
