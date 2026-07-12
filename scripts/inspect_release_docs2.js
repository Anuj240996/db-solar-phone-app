const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
  connectionTimeoutMillis: 15000,
});

async function main() {
  const cols = await pool.query(`
    SELECT column_name, data_type, character_maximum_length, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customer_release_agreement'
    ORDER BY ordinal_position
  `);
  console.log('COLUMNS:');
  for (const c of cols.rows) console.log(c);

  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM customer_release_agreement`);
  console.log('\nCOUNT:', count.rows[0].n);

  const sample = await pool.query(`
    SELECT id, customer_id,
           pdf, release_pdf, agreement_pdf,
           (release_pdf_data IS NOT NULL) AS has_release_bytes,
           CASE WHEN release_pdf_data IS NOT NULL THEN length(release_pdf_data) ELSE 0 END AS release_bytes_len,
           (agreement_pdf_data IS NOT NULL) AS has_agreement_bytes,
           CASE WHEN agreement_pdf_data IS NOT NULL THEN length(agreement_pdf_data) ELSE 0 END AS agreement_bytes_len,
           created_at, updated_at
    FROM customer_release_agreement
    ORDER BY id DESC
    LIMIT 10
  `);
  console.log('\nSAMPLE:');
  console.dir(sample.rows, { depth: 3 });

  // Check FKs / unique
  const constraints = await pool.query(`
    SELECT tc.constraint_type, tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema='public' AND tc.table_name='customer_release_agreement'
    ORDER BY 1,2
  `);
  console.log('\nCONSTRAINTS:', constraints.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
