const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// Quick smoke test against local helpers by querying DB directly
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
});

async function main() {
  const meta = await pool.query(`
    SELECT id, consumer_id_id,
      (release_pdf_data IS NOT NULL AND octet_length(release_pdf_data) > 4) AS has_release_pdf,
      (agreement_pdf_data IS NOT NULL AND octet_length(agreement_pdf_data) > 4) AS has_agreement_pdf
    FROM customer_release_agreement
    WHERE consumer_id_id = 1001
    LIMIT 1
  `);
  console.log('meta1001', meta.rows[0]);

  const bytes = await pool.query(`
    SELECT octet_length(release_pdf_data) AS n,
           encode(substring(release_pdf_data from 1 for 5), 'escape') AS head
    FROM customer_release_agreement WHERE consumer_id_id=1001 LIMIT 1
  `);
  console.log('bytes1001', bytes.rows[0]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
