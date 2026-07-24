const pool = require('../database/db');

async function main() {
  try {
    const links = await pool.query(`
      SELECT * FROM app_auth_links
      WHERE app_user_id IN (65, 198) OR auth_user_id IN (65, 198)
    `);
    console.log('app_auth_links:', links.rows);
  } catch (e) {
    console.log('app_auth_links error:', e.message);
  }

  for (const id of [65, 198]) {
    for (const table of ['user_app', 'users', 'auth_user']) {
      try {
        const r = await pool.query(`SELECT id, email, phone, name FROM ${table} WHERE id = $1`, [id]);
        if (r.rows.length) console.log(`${table} id ${id}:`, r.rows[0]);
      } catch (_) {}
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
