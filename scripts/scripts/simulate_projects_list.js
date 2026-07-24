const pool = require('../database/db');

async function main() {
  const customers = await pool.query(`
    SELECT cust_id, comp_name, consumer, plant_capacity, new_customer_id
    FROM customer
    WHERE comp_name ILIKE '%ashwi%' OR comp_name ILIKE '%high%court%'
  `);

  for (const customer of customers.rows) {
    const plantCapacityFromCustomer =
      customer.plant_capacity != null && Number(customer.plant_capacity) > 0
        ? String(customer.plant_capacity)
        : '0';

    const project = {
      id: customer.cust_id,
      projectName: customer.comp_name,
      plant_capacity: customer.plant_capacity,
      plantCapacity: plantCapacityFromCustomer,
    };
    console.log(JSON.stringify(project));
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
