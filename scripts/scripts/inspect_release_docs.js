const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
  connectionTimeoutMillis: 15000,
});

async function main() {
  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (
        table_name ILIKE '%release%'
        OR table_name ILIKE '%agreem%'
        OR table_name ILIKE '%pdf%'
        OR table_name ILIKE '%document%'
        OR table_name ILIKE '%media%'
        OR table_name ILIKE '%file%'
      )
    ORDER BY 1
  `);
  console.log('NAME_MATCHES:', tables.rows.map((r) => r.table_name));

  const cols = await pool.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        column_name ILIKE '%release%'
        OR column_name ILIKE '%agreem%'
        OR column_name ILIKE '%pdf%'
        OR column_name ILIKE '%document%'
        OR column_name ILIKE '%file%'
        OR column_name ILIKE '%path%'
        OR column_name ILIKE '%url%'
      )
    ORDER BY table_name, ordinal_position
  `);
  console.log('COLUMN_MATCHES:');
  for (const row of cols.rows) {
    console.log(`  ${row.table_name}.${row.column_name} (${row.data_type})`);
  }

  // If a release table exists, describe it and sample rows
  const exact = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('release','releases','customer_release','agreement','agreements')
  `);
  for (const t of exact.rows) {
    const desc = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [t.table_name]
    );
    console.log(`\nTABLE ${t.table_name}:`, desc.rows);
    const sample = await pool.query(`SELECT * FROM "${t.table_name}" LIMIT 3`);
    console.log('SAMPLE:', sample.rows);
  }

  // Also check django content types for release models
  try {
    const ct = await pool.query(`
      SELECT app_label, model FROM django_content_type
      WHERE model ILIKE '%release%' OR model ILIKE '%agreem%' OR model ILIKE '%pdf%'
      ORDER BY 1,2
    `);
    console.log('\nDJANGO_CONTENT_TYPES:', ct.rows);
  } catch (e) {
    console.log('django_content_type check skipped:', e.message);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
