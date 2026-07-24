require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

async function main() {
  const cust = await pool.query(`
    SELECT cust_id, comp_name, new_customer_id, phone, city, consumer
    FROM customer
    WHERE comp_name ILIKE '%vinay%surana%' OR comp_name ILIKE '%sambhajinagar%'
    ORDER BY cust_id DESC LIMIT 5
  `);
  console.log('customers:', cust.rows);

  for (const c of cust.rows) {
    const authId = c.new_customer_id;
    const barcodes = await pool.query(
      `SELECT barcode_data FROM detect_barcodes_barcodeimage
       WHERE assignto_id = $1 AND barcode_data ILIKE '%NSM535052300830%' LIMIT 3`,
      [authId]
    );
    console.log(`cust ${c.cust_id} auth ${authId} barcode match:`, barcodes.rows);

    try {
      await pool.query('BEGIN');
      const r = await pool.query(
        `INSERT INTO firereport_servicerequest
          (fullname, mobilenumber, "Location", message, service_type, additional_notes, warranty_type, status, postingdate, account_id, assignby, app_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          c.comp_name,
          c.phone || '0',
          c.city || '',
          'Inverter service / fault',
          'Inverter service / fault',
          'test',
          'Annual maintenance service (AMC)',
          'Pending',
          new Date(),
          authId,
          authId,
          null,
        ]
      );
      console.log('insert OK id', r.rows[0].id);
      await pool.query('ROLLBACK');
    } catch (e) {
      await pool.query('ROLLBACK');
      console.log('insert FAIL:', e.message);
    }
  }

  const links = await pool.query('SELECT COUNT(*)::int n FROM app_auth_links');
  console.log('app_auth_links:', links.rows[0].n);

  const svc = await pool.query('SELECT COUNT(*)::int n FROM firereport_servicerequest');
  console.log('service rows:', svc.rows[0].n);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
