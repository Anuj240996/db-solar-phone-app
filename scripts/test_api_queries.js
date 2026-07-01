require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

async function main() {
  const ownerId = 65;
  const sql = `
    SELECT sr.*,
      au.first_name AS engineer_first_name,
      c_disp.comp_name AS consumer_display_name
    FROM firereport_servicerequest sr
    LEFT JOIN auth_user au ON sr.assignto_id = au.id
    LEFT JOIN LATERAL (
      SELECT comp_name FROM customer
      WHERE new_customer_id = COALESCE(sr.assignby, sr.account_id)
      ORDER BY cust_id DESC
      LIMIT 1
    ) c_disp ON true
    WHERE (sr.account_id = $1 OR sr.account_id = ANY($2::int[]))
    ORDER BY sr.postingdate DESC
    LIMIT 3`;
  try {
    const r = await pool.query(sql, [ownerId, [ownerId]]);
    console.log('service list ok, rows:', r.rows.length);
  } catch (e) {
    console.error('service list SQL error:', e.message);
  }

  try {
    const ins = await pool.query(
      `INSERT INTO app_support_queries (app_user_id, auth_user_id, subject, message)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [null, 65, 'test', 'test msg']
    );
    console.log('support insert ok', ins.rows[0].id);
    await pool.query('DELETE FROM app_support_queries WHERE id = $1', [ins.rows[0].id]);
  } catch (e) {
    console.error('support insert error:', e.message);
  }

  try {
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='leads_lead' AND column_name != 'id'`
    );
    console.log('leads insertable cols:', cols.rows.length);
  } catch (e) {
    console.error('leads cols error:', e.message);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
