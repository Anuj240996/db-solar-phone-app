const { Pool } = require('pg');
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
});

async function main() {
  const cons = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'crm_leads_lead'::regclass
  `);
  console.log('CONSTRAINTS', cons.rows);

  // Try insert dry-run with rollback
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO crm_leads_lead (
        created, modified, id, name, phone, email, alternate_phone,
        address, city, state, pincode, property_type, roof_type,
        stage, score, probability, notes, internal_notes, lost_reason, competitor,
        organization_id, source_id
      ) VALUES (
        NOW(), NOW(), gen_random_uuid(), 'Test App Lead', '9999999999', 'test@example.com', '',
        'Test Address', 'Pune', 'Maharashtra', '411001', 'residential', 'flat',
        'new', 'medium', 10, '', '', '', '',
        1, 11
      ) RETURNING id, stage, score, organization_id, source_id`
    );
    console.log('INSERT OK', r.rows[0]);
    await client.query('ROLLBACK');
    console.log('ROLLED BACK');
  } catch (e) {
    await client.query('ROLLBACK');
    console.log('INSERT FAIL', e.message);
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
