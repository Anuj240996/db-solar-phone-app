const { Pool } = require('pg');

(async () => {
  const admin = new Pool({
    connectionString: 'postgresql://admin:root@localhost:5432/postgres',
    ssl: false,
  });
  try {
    for (const db of ['db_solar_v2', 'db_solar']) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [db]
      );
    }
    await new Promise((r) => setTimeout(r, 500));
    await admin.query('DROP DATABASE IF EXISTS db_solar_v2');
    await admin.query('CREATE DATABASE db_solar_v2 WITH TEMPLATE db_solar OWNER admin');
    console.log('Cloned db_solar -> db_solar_v2');
  } catch (e) {
    console.error('Clone failed:', e.message);
    process.exit(1);
  } finally {
    await admin.end();
  }

  const pool = new Pool({
    connectionString: 'postgresql://admin:root@localhost:5432/db_solar_v2',
    ssl: false,
  });
  try {
    const users = await pool.query('SELECT COUNT(*)::int AS n FROM user_app');
    console.log('user_app rows:', users.rows[0].n);
  } finally {
    await pool.end();
  }
})();
