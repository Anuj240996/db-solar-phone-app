/**
 * Call VPS API: login + GET /projects + GET /projects/1014
 * Usage: node scripts/test_vps_project_status.js [username] [password]
 */
const axios = require('axios');

const BASE = 'http://72.60.98.248:8080/api';

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];

  if (!username || !password) {
    console.log('Usage: node scripts/test_vps_project_status.js <username> <password>');
    console.log('Trying DB-only status check instead...');
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://heramb:Heramb2023@72.60.98.248:2700/db_solar_v2',
    });
    const { fetchCustomerResultForCustomer, computeProjectStatusFromResult } = require('../utils/customerResult');
    const c = (await pool.query('SELECT * FROM customer WHERE cust_id=1014')).rows[0];
    const r = await fetchCustomerResultForCustomer(c);
    console.log('DB inspection_report:', r?.inspection_report);
    console.log('DB computed status:', computeProjectStatusFromResult(r));
    await pool.end();
    return;
  }

  const login = await axios.post(`${BASE}/auth/login`, { username, password });
  const token = login.data?.token;
  if (!token) {
    console.error('Login failed:', login.status, login.data);
    process.exit(1);
  }
  console.log('Login OK');

  const headers = { Authorization: `Bearer ${token}` };
  const bust = { _: Date.now() };

  const list = await axios.get(`${BASE}/projects`, { headers, params: bust });
  const projects = list.data?.projects || [];
  const pradip = projects.find(
    (p) =>
      String(p.id) === '1014' ||
      String(p.projectId) === '1014' ||
      (p.projectName || '').includes('Pradip Dhote')
  );
  console.log('\n=== GET /projects (Pradip) ===');
  console.log(JSON.stringify(pradip || { message: 'not in list', count: projects.length }, null, 2));

  const detail = await axios.get(`${BASE}/projects/1014`, { headers, params: bust });
  const project = detail.data?.project;
  console.log('\n=== GET /projects/1014 status ===');
  console.log('status:', project?.status);
  console.log('progress.projectStatus:', project?.progress?.projectStatus);
  console.log('progress.inspectionReport:', project?.progress?.inspectionReport);
  console.log('solar completed:', project?.progress?.solarPanel?.completed);
  console.log('mseb completed:', project?.progress?.mseb?.completed);
}

main().catch((e) => {
  console.error(e.response?.data || e.message);
  process.exit(1);
});
