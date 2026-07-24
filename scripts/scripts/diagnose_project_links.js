/**
 * Diagnose project list / app_auth_links on production.
 * Run on VPS: node scripts/diagnose_project_links.js [app_user_id] [auth_username]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../database/db');

async function main() {
  const appUserIdArg = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const authLogin = process.argv[3] || null;

  console.log('DATABASE_URL host:', (process.env.DATABASE_URL || '').replace(/:[^:@]+@/, ':***@'));

  const tables = ['app_auth_links', 'customer', 'auth_user', 'user_app'];
  for (const t of tables) {
    const r = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS ok`,
      [t]
    );
    console.log(`table ${t}:`, r.rows[0].ok ? 'OK' : 'MISSING');
  }

  const linkCount = await pool.query('SELECT COUNT(*)::int AS n FROM app_auth_links');
  console.log('app_auth_links rows:', linkCount.rows[0].n);

  if (appUserIdArg && !isNaN(appUserIdArg)) {
    const links = await pool.query(
      'SELECT * FROM app_auth_links WHERE app_user_id = $1 ORDER BY created_at DESC',
      [appUserIdArg]
    );
    console.log(`\nLinks for app_user_id=${appUserIdArg}:`, links.rows);

    const authIds = links.rows.map((r) => r.auth_user_id);
    if (authIds.length) {
      const projects = await pool.query(
        `SELECT cust_id, consumer, comp_name, new_customer_id
         FROM customer WHERE new_customer_id::bigint = ANY($1::bigint[])`,
        [authIds]
      );
      console.log('customer rows for linked auth ids:', projects.rows);
    } else {
      console.log('No links — project list will be empty for user_app login.');
    }
  }

  if (authLogin) {
    const au = await pool.query(
      `SELECT id, username, email FROM auth_user
       WHERE username = $1 OR email = $1 LIMIT 1`,
      [authLogin]
    );
    if (!au.rows.length) {
      console.log('\nauth_user not found for:', authLogin);
    } else {
      const uid = au.rows[0].id;
      console.log('\nauth_user:', au.rows[0]);
      const cust = await pool.query(
        `SELECT cust_id, consumer, comp_name, new_customer_id FROM customer WHERE new_customer_id = $1`,
        [uid]
      );
      console.log('customer projects for this auth_user:', cust.rows);
      const linksTo = await pool.query(
        'SELECT * FROM app_auth_links WHERE auth_user_id = $1',
        [uid]
      );
      console.log('app_auth_links pointing to this auth_user:', linksTo.rows);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
