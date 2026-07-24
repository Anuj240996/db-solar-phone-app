const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const vpsFile = path.join(__dirname, 'vps_tables.txt');
const vps = fs
  .readFileSync(vpsFile, 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const localUrl =
  process.env.LOCAL_DATABASE_URL ||
  'postgresql://admin:root@localhost:5432/db_solar_v2';

(async () => {
  const pool = new Pool({ connectionString: localUrl, ssl: false });
  const { rows } = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  await pool.end();

  const local = rows.map((r) => r.table_name);
  const vpsSet = new Set(vps);
  const localSet = new Set(local);

  const onlyLocal = local.filter((t) => !vpsSet.has(t));
  const onlyVps = vps.filter((t) => !localSet.has(t));
  const both = local.filter((t) => vpsSet.has(t));

  console.log(`Local: ${local.length} tables | VPS: ${vps.length} tables | Shared: ${both.length}`);
  console.log(`\n=== ONLY IN LOCAL (${onlyLocal.length}) — not on VPS ===`);
  onlyLocal.forEach((t) => console.log(`  ${t}`));

  console.log(`\n=== ONLY IN VPS (${onlyVps.length}) — not on local ===`);
  if (onlyVps.length === 0) console.log('  (none)');
  else onlyVps.forEach((t) => console.log(`  ${t}`));
})();
