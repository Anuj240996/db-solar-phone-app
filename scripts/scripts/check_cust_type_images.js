require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');
const { resolveCustTypeKey, buildProjectTypeImageUrl } = require('../utils/projectBuilders');

(async () => {
  const r = await pool.query(`
    SELECT cust_id, comp_name, consumer, city, cust_type, project_type, solar_pump, plant_capacity
    FROM customer
    WHERE comp_name ILIKE '%Chairman Lift%'
       OR comp_name ILIKE '%Avinash Wable%'
       OR comp_name ILIKE '%Wable%'
    ORDER BY cust_id DESC
    LIMIT 30
  `);
  for (const row of r.rows) {
    console.log({
      cust_id: row.cust_id,
      comp_name: row.comp_name,
      city: row.city,
      cust_type: row.cust_type,
      project_type: row.project_type,
      key: resolveCustTypeKey(row),
      image: buildProjectTypeImageUrl(row),
    });
  }
  console.log('count', r.rows.length);

  const t = await pool.query(`
    SELECT COALESCE(cust_type, '(null)') AS cust_type, COUNT(*)::int AS n
    FROM customer
    GROUP BY cust_type
    ORDER BY n DESC
    LIMIT 20
  `);
  console.log('cust_type values:', t.rows);

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
