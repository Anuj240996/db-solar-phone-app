require('dotenv').config();
const pool = require('../database/db');

async function main() {
  const complaint = await pool.query(`
    SELECT f.id, f.status, f.assignto_id, f.assignedtime, f.complete_date,
           au.first_name, au.last_name
    FROM firereport_firereport f
    LEFT JOIN auth_user au ON f.assignto_id = au.id
    WHERE f.id = 58 OR f.status ILIKE '%complete%'
    ORDER BY f.id DESC
    LIMIT 5
  `);
  console.log('complaints:', complaint.rows);

  const history = await pool.query(`
    SELECT id, status, remark, firereport_id, assignto_id
    FROM firereport_firetequesthistory
    WHERE firereport_id = 58
    ORDER BY id
  `);
  console.log('history for 58:', history.rows);

  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profile'
    ORDER BY ordinal_position
  `);
  console.log('user_profile columns:', cols.rows.map((r) => r.column_name));

  const profile = await pool.query(`
    SELECT up.*
    FROM user_profile up
    WHERE up.customer_id = 8
    LIMIT 1
  `);
  console.log('profile for engineer 8:', profile.rows[0]);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
