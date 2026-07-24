/**
 * Compare public tables between local and VPS PostgreSQL databases.
 *
 * Usage (from backend/):
 *   node scripts/compare_databases.js
 *
 * Optional env overrides in .env or shell:
 *   LOCAL_DATABASE_URL=postgresql://admin:root@localhost:5432/db_solar_v2
 *   VPS_DATABASE_URL=postgresql://heramb:Heramb2023@72.60.98.248:5432/db_solar_v2
 *
 * Note: db_solar_database only resolves on the VPS (Docker). From Windows use VPS IP
 * or an SSH tunnel, e.g.:
 *   ssh -L 5433:db_solar_database:5432 user@72.60.98.248
 *   VPS_DATABASE_URL=postgresql://heramb:Heramb2023@127.0.0.1:5433/db_solar_v2
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const LOCAL_URL =
  process.env.LOCAL_DATABASE_URL ||
  'postgresql://admin:root@localhost:5432/db_solar_v2';

const VPS_URL =
  process.env.VPS_DATABASE_URL ||
  process.env.VPS_DATABASE_URL_OVERRIDE ||
  'postgresql://heramb:Heramb2023@72.60.98.248:5432/db_solar_v2';

function maskUrl(url) {
  return url.replace(/:([^:@/]+)@/, ':***@');
}

async function fetchPublicTables(pool) {
  const { rows } = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return rows.map((r) => r.table_name);
}

async function probe(label, url) {
  const pool = new Pool({ connectionString: url, ssl: false, connectionTimeoutMillis: 15000 });
  try {
    const db = await pool.query('SELECT current_database() AS name');
    const tables = await fetchPublicTables(pool);
    return { ok: true, label, db: db.rows[0].name, tables, url: maskUrl(url) };
  } catch (err) {
    return { ok: false, label, error: err.message, url: maskUrl(url) };
  } finally {
    await pool.end();
  }
}

function diff(onlyA, onlyB, nameA, nameB) {
  const setB = new Set(onlyB);
  const setA = new Set(onlyA);
  const inANotB = onlyA.filter((t) => !setB.has(t));
  const inBNotA = onlyB.filter((t) => !setA.has(t));
  const inBoth = onlyA.filter((t) => setB.has(t));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Tables only in ${nameA} (${inANotB.length})`);
  console.log('='.repeat(60));
  if (inANotB.length === 0) console.log('  (none)');
  else inANotB.forEach((t) => console.log(`  - ${t}`));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Tables only in ${nameB} (${inBNotA.length})`);
  console.log('='.repeat(60));
  if (inBNotA.length === 0) console.log('  (none)');
  else inBNotA.forEach((t) => console.log(`  - ${t}`));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Tables in both (${inBoth.length})`);
  console.log('='.repeat(60));
  console.log(`  ${inBoth.length} shared table(s)`);

  return { inANotB, inBNotA, inBoth };
}

(async () => {
  console.log('DB Solar — compare public tables (local vs VPS)\n');
  console.log('Local:', maskUrl(LOCAL_URL));
  console.log('VPS:  ', maskUrl(VPS_URL));

  const [local, vps] = await Promise.all([
    probe('LOCAL', LOCAL_URL),
    probe('VPS', VPS_URL),
  ]);

  if (!local.ok) {
    console.error('\n❌ Local DB failed:', local.error);
    console.error('   Set LOCAL_DATABASE_URL or uncomment local settings in .env');
  } else {
    console.log(`\n✅ Local connected: ${local.db} (${local.tables.length} tables)`);
  }

  if (!vps.ok) {
    console.error('\n❌ VPS DB failed:', vps.error);
    console.error('   From Windows, db_solar_database does not resolve.');
    console.error('   Options:');
    console.error('   1) Set VPS_DATABASE_URL with server IP if port 5432 is open');
    console.error('   2) SSH tunnel: ssh -L 5433:db_solar_database:5432 user@72.60.98.248');
    console.error('      then VPS_DATABASE_URL=postgresql://heramb:***@127.0.0.1:5433/db_solar_v2');
    console.error('   3) Run this script on the VPS: node scripts/compare_databases.js');
  } else {
    console.log(`✅ VPS connected: ${vps.db} (${vps.tables.length} tables)`);
  }

  if (local.ok && vps.ok) {
    diff(local.tables, vps.tables, 'LOCAL', 'VPS');
    console.log('\nDone.');
  } else {
    if (local.ok && !vps.ok) {
      console.log('\n(Local has', local.tables.length, 'tables — full compare needs VPS connection.)');
    } else if (!local.ok && vps.ok) {
      console.log('\n--- VPS tables only (local unreachable) ---');
      vps.tables.forEach((t) => console.log(`  ${t}`));
    }
  }

  process.exit(local.ok && vps.ok ? 0 : 1);
})();
