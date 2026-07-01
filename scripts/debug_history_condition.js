require('dotenv').config();
const pool = require('../database/db');

async function main() {
  const row = await pool.query(`
    SELECT f.id, f.assignto_id, f.assignedtime, f.progress_date, f.working_date, f.complete_date, f.status
    FROM firereport_firereport f
    WHERE f.id = 58
  `);
  console.log('row', row.rows[0]);

  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'firereport_firetequesthistory'
    ORDER BY ordinal_position
  `);
  console.log('history columns', cols.rows.map((r) => r.column_name));

  const history = await pool.query(`
    SELECT *
    FROM firereport_firetequesthistory
    WHERE firereport_id = $1
    ORDER BY id ASC
  `, [58]);
  console.log('history count', history.rows.length, history.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
