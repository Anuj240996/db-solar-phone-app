/**
 * End-to-end service create test (local DB + route helpers).
 * Usage: node scripts/test_service_create_e2e.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');
const {
  getAppAccessContext,
  resolveCustomerFields,
} = require('../utils/appAccess');

async function main() {
  const authRow = await pool.query(
    `SELECT id, email, username FROM auth_user WHERE id = 30 LIMIT 1`
  );
  if (!authRow.rows.length) {
    console.log('auth_user 30 not found — skip');
    await pool.end();
    return;
  }

  const req = {
    user: {
      id: '30',
      auth_user_id: 30,
      auth_source: 'auth_user',
      email: authRow.rows[0].email,
      jwt_source: 'auth_user',
      jwt_user_id: '30',
    },
  };

  const ctx = await getAppAccessContext(req);
  console.log('ctx:', ctx);

  const fields = await resolveCustomerFields(
    ctx.appOwnerId,
    ctx.linkedAuthIds,
    1011,
    req,
    ctx
  );
  console.log('customer fields:', fields);

  const { insertServiceRequestRow } = require('../routes/services');
  // insertServiceRequestRow is not exported - test insert inline
  const postingDate = new Date();
  const insertResult = await pool.query(
    `INSERT INTO firereport_servicerequest
      (fullname, mobilenumber, "Location", message, service_type, additional_notes, warranty_type, status, postingdate, account_id, assignby, app_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      fields.fullName,
      fields.mobileNumber || '0',
      fields.location || '',
      'Inverter service / fault',
      'Inverter service / fault',
      'ff',
      'Annual maintenance service (AMC)',
      'Pending',
      postingDate,
      fields.authUserId,
      fields.authUserId,
      null,
    ]
  );
  const id = insertResult.rows[0].id;
  console.log('inserted id:', id);
  await pool.query('DELETE FROM firereport_servicerequest WHERE id = $1', [id]);
  console.log('rolled back test row');

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
