/**
 * Diagnostic: customer.cust_id vs customer_mseb.customer_id linkage
 */
const pool = require('../database/db');

async function main() {
  const q1 = await pool.query(`
    SELECT c.cust_id, c.consumer, c.comp_name, c.new_customer_id,
           cr.inspection_report, cr.mseb as mseb_flag,
           (SELECT COUNT(*)::int FROM customer_mseb m WHERE m.customer_id = c.cust_id) as mseb_by_cust_id,
           (SELECT COUNT(*)::int FROM customer_mseb m2
            WHERE TRIM(LOWER(COALESCE(m2.comp_name,''))) = TRIM(LOWER(COALESCE(c.comp_name,'')))
              AND COALESCE(c.comp_name,'') <> '') as mseb_by_comp_name
    FROM customer c
    LEFT JOIN customer_result cr ON cr.consumer_id_id = c.cust_id
    ORDER BY c.cust_id DESC
    LIMIT 25
  `);

  console.log('Recent projects MSEB linkage:');
  for (const r of q1.rows) {
    console.log(
      `cust_id=${r.cust_id} consumer=${r.consumer} mseb_rows(cust_id)=${r.mseb_by_cust_id} mseb_rows(comp_name)=${r.mseb_by_comp_name ?? 'n/a'} comp=${(r.comp_name || '').slice(0, 40)}`
    );
  }

  const q2 = await pool.query(`
    SELECT m.id, m.customer_id, m.comp_name
    FROM customer_mseb m
    LEFT JOIN customer c ON c.cust_id = m.customer_id
    WHERE c.cust_id IS NULL
    LIMIT 10
  `);
  console.log('\nMSEB rows with missing customer.cust_id:', q2.rows.length);
  q2.rows.forEach((r) => console.log(`  mseb#${r.id} customer_id=${r.customer_id} comp=${r.comp_name}`));

  const q3 = await pool.query(`
    SELECT c.cust_id, c.comp_name, m.customer_id as mseb_customer_id, m.id as mseb_id
    FROM customer c
    JOIN customer_mseb m ON TRIM(LOWER(m.comp_name)) = TRIM(LOWER(c.comp_name))
    WHERE m.customer_id IS DISTINCT FROM c.cust_id
      AND COALESCE(c.comp_name,'') <> ''
    LIMIT 15
  `);
  console.log('\nSame comp_name but different customer_id:', q3.rows.length);
  q3.rows.forEach((r) =>
    console.log(`  cust_id=${r.cust_id} mseb.customer_id=${r.mseb_customer_id} comp=${(r.comp_name || '').slice(0, 35)}`)
  );

  const q4 = await pool.query(`
    SELECT c.cust_id, c.comp_name
    FROM customer c
    WHERE EXISTS (
      SELECT 1 FROM customer_mseb m
      WHERE TRIM(LOWER(m.comp_name)) = TRIM(LOWER(c.comp_name))
        AND m.customer_id IS DISTINCT FROM c.cust_id
    )
    AND NOT EXISTS (SELECT 1 FROM customer_mseb m2 WHERE m2.customer_id = c.cust_id)
    LIMIT 10
  `);
  console.log('\nProjects with MSEB only by comp_name (not cust_id):', q4.rows.length);
  q4.rows.forEach((r) => console.log(`  cust_id=${r.cust_id} comp=${r.comp_name}`));

  const q5 = await pool.query(`
    SELECT c.cust_id, c.comp_name, c.consumer,
           cr.consumer_id_id,
           (SELECT COUNT(*)::int FROM customer_mseb m WHERE m.customer_id = c.cust_id) as mseb_cust,
           (SELECT m.customer_id FROM customer_mseb m
            WHERE TRIM(LOWER(m.comp_name)) = TRIM(LOWER(c.comp_name))
            ORDER BY m.id DESC LIMIT 1) as mseb_via_name
    FROM customer c
    INNER JOIN customer_result cr ON cr.consumer_id_id = c.cust_id
    WHERE cr.inspection_report::text IN ('1', 'true', 't')
       OR cr.inspection_report = B'1'
    ORDER BY c.cust_id DESC
    LIMIT 15
  `);
  console.log('\nInspection-report completed (by consumer_id_id):');
  q5.rows.forEach((r) =>
    console.log(
      `  cust_id=${r.cust_id} mseb@cust=${r.mseb_cust} mseb_via_name=${r.mseb_via_name} consumer_id_id=${r.consumer_id_id} comp=${(r.comp_name || '').slice(0, 30)}`
    )
  );
}

main()
  .catch((e) => console.error(e.message))
  .finally(() => process.exit(0));
