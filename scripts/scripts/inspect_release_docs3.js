const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
  connectionTimeoutMillis: 15000,
});

async function main() {
  const sample = await pool.query(`
    SELECT id, consumer_id_id, result_id, title, pdf, release_pdf, agreement_pdf,
           (release_pdf_data IS NOT NULL) AS has_release_bytes,
           CASE WHEN release_pdf_data IS NOT NULL THEN length(release_pdf_data) ELSE 0 END AS release_bytes_len,
           (agreement_pdf_data IS NOT NULL) AS has_agreement_bytes,
           CASE WHEN agreement_pdf_data IS NOT NULL THEN length(agreement_pdf_data) ELSE 0 END AS agreement_bytes_len,
           created_at, updated_at, created_by_id
    FROM customer_release_agreement
    ORDER BY id DESC
  `);
  console.log('ROWS:');
  console.dir(sample.rows, { depth: 3 });

  // Join to customer names
  const joined = await pool.query(`
    SELECT r.id, r.consumer_id_id, c.cust_id, c.consumer, c.comp_name, c.first_name, c.last_name,
           r.title, r.release_pdf, r.agreement_pdf,
           length(COALESCE(r.release_pdf_data, ''::bytea)) AS release_len,
           length(COALESCE(r.agreement_pdf_data, ''::bytea)) AS agreement_len
    FROM customer_release_agreement r
    LEFT JOIN customer c ON c.cust_id = r.consumer_id_id
    ORDER BY r.id DESC
  `);
  console.log('\nJOINED:');
  console.dir(joined.rows, { depth: 3 });

  // Check if pdf paths look like media paths and if magic bytes of PDFs exist
  const magic = await pool.query(`
    SELECT id,
           encode(substring(release_pdf_data from 1 for 5), 'escape') AS release_head,
           encode(substring(agreement_pdf_data from 1 for 5), 'escape') AS agreement_head
    FROM customer_release_agreement
    WHERE release_pdf_data IS NOT NULL OR agreement_pdf_data IS NOT NULL
    LIMIT 5
  `);
  console.log('\nMAGIC:', magic.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
