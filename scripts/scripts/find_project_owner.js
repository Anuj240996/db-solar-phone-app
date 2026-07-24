const pool = require('../database/db');

async function main() {
  const owners = await pool.query(`
    SELECT new_customer_id, array_agg(comp_name) AS projects, array_agg(plant_capacity) AS capacities
    FROM customer
    WHERE comp_name ILIKE '%ashwi%' OR comp_name ILIKE '%high%court%'
    GROUP BY new_customer_id
  `);
  console.log('Owners:', owners.rows);

  const multi = await pool.query(`
    SELECT new_customer_id, COUNT(*) AS cnt
    FROM customer
    WHERE new_customer_id IS NOT NULL
    GROUP BY new_customer_id
    HAVING COUNT(*) >= 2
    ORDER BY cnt DESC
    LIMIT 20
  `);
  console.log('Users with 2+ projects:', multi.rows);

  for (const row of multi.rows.slice(0, 5)) {
    const projects = await pool.query(
      `SELECT cust_id, comp_name, plant_capacity FROM customer WHERE new_customer_id = $1`,
      [row.new_customer_id]
    );
    const names = projects.rows.map((p) => p.comp_name).join(', ');
    if (names.toLowerCase().includes('ashwi') || names.toLowerCase().includes('court')) {
      console.log(`\nMatch user ${row.new_customer_id}:`, projects.rows);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
