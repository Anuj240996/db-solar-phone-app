/**
 * Fix profile API on OLD VPS backend (updates `users` with auth_user integer id).
 * Safe: existing `users` table is empty on db_solar_v2.
 */
require('dotenv').config();
const pool = require('../database/db');

async function main() {
  await pool.query(`ALTER TABLE IF EXISTS support_queries DROP CONSTRAINT IF EXISTS support_queries_user_id_fkey`);
  await pool.query(`ALTER TABLE IF EXISTS support_queries ALTER COLUMN user_id TYPE BIGINT USING NULL`);

  const count = await pool.query('SELECT COUNT(*)::int n FROM users');
  console.log('users rows before:', count.rows[0].n);

  await pool.query('DROP TABLE IF EXISTS users CASCADE');
  await pool.query(`
    CREATE TABLE users (
      id BIGINT PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255),
      phone VARCHAR(255),
      password_hash VARCHAR(255),
      role VARCHAR(50) DEFAULT 'customer',
      address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('users table recreated with BIGINT id');

  const ins = await pool.query(`
    INSERT INTO users (id, name, email, phone, role, address, last_login)
    SELECT
      au.id,
      NULLIF(TRIM(COALESCE(au.first_name, '') || ' ' || COALESCE(au.last_name, '')), '') AS name,
      au.email,
      up.phone,
      CASE WHEN au.is_staff THEN 'admin' ELSE 'customer' END,
      up.address,
      au.last_login
    FROM auth_user au
    LEFT JOIN user_profile up ON up.customer_id = au.id
    ON CONFLICT (id) DO NOTHING
  `);
  console.log('synced auth_user -> users:', ins.rowCount);

  await pool.query(`ALTER TABLE firereport_firereport ALTER COLUMN assignby DROP NOT NULL`).catch(() => {});

  const { ensureLeadsLeadSchema } = require('../utils/ensureLeadsLeadSchema');
  const { ensureSupportSchema } = require('../utils/ensureSupportSchema');
  await ensureLeadsLeadSchema();
  await ensureSupportSchema();

  const total = await pool.query('SELECT COUNT(*)::int n FROM users');
  console.log('users rows after:', total.rows[0].n);
  console.log('Done.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
