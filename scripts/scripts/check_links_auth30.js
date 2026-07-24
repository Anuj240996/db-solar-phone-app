require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

async function main() {
  const links = await pool.query(`
    SELECT l.*, au.email, au.username
    FROM app_auth_links l
    LEFT JOIN auth_user au ON au.id = l.auth_user_id
    WHERE l.auth_user_id = 30 OR au.email ILIKE '%gamma%'
    ORDER BY l.created_at DESC
    LIMIT 20
  `);
  console.log('links for auth 30 / gamma:', links.rows);

  const total = await pool.query('SELECT COUNT(*)::int n FROM app_auth_links');
  console.log('total links:', total.rows[0].n);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
