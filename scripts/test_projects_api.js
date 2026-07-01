const pool = require('../database/db');

async function main() {
  const customers = await pool.query(`
    SELECT cust_id, comp_name, plant_capacity, new_customer_id
    FROM customer
    WHERE comp_name ILIKE '%ashwi%' OR comp_name ILIKE '%high%court%'
  `);

  console.log('Customers:', customers.rows);

  for (const customer of customers.rows) {
    const appUserId = customer.new_customer_id;
    if (!appUserId) continue;

    const user = await pool.query(
      'SELECT id, email, phone, name FROM user_app WHERE id = $1 LIMIT 1',
      [appUserId]
    );
    console.log(`\nApp user for ${customer.comp_name}:`, user.rows[0] || 'NOT FOUND');

    const rows = await pool.query(
      `SELECT cust_id, comp_name, plant_capacity
       FROM customer
       WHERE new_customer_id = $1`,
      [appUserId]
    );

    const projects = rows.rows.map((c) => ({
      id: c.cust_id,
      projectName: c.comp_name,
      plant_capacity: c.plant_capacity,
      plantCapacity:
        c.plant_capacity != null && Number(c.plant_capacity) > 0
          ? String(c.plant_capacity)
          : '0',
    }));
    console.log('Would return projects:', JSON.stringify(projects, null, 2));
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
