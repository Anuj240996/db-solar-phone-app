require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../database/db');

(async () => {
  const r = await pool.query(`
    SELECT cust_id, cust_type
    FROM customer
    WHERE cust_type IS NOT NULL AND TRIM(cust_type) <> ''
  `);
  const map = {};
  for (const row of r.rows) {
    map[String(row.cust_id)] = String(row.cust_type).trim();
  }
  const outDir = path.join(__dirname, '..', '..', 'assets', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'customer_cust_types.json');
  fs.writeFileSync(out, JSON.stringify(map));
  console.log('wrote', out, 'entries', Object.keys(map).length);
  console.log('1054=', map['1054'], '1039=', map['1039']);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
