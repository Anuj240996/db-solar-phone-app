/**
 * Test VPS POST /api/services with JWT for auth_user who owns Gamma (cust 1011).
 * Usage: node scripts/test_vps_service_create.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const axios = require('axios');
const pool = require('../database/db');

const BASE = 'http://72.60.98.248:8080/api';

async function main() {
  const health = await axios.get(`${BASE}/health`);
  console.log('health:', health.data);

  const cust = await pool.query(
    `SELECT cust_id, comp_name, new_customer_id FROM customer WHERE cust_id = 1011`
  );
  console.log('customer:', cust.rows[0]);

  const authId = cust.rows[0]?.new_customer_id;
  const au = await pool.query(
    'SELECT id, email, username FROM auth_user WHERE id = $1',
    [authId]
  );
  console.log('auth_user:', au.rows[0]);

  const secrets = [
    process.env.JWT_SECRET,
    'your-super-secret-jwt-key-change-this-in-production',
  ].filter(Boolean);

  const uniqueSecrets = [...new Set(secrets)];

  for (const secret of uniqueSecrets) {
    const token = jwt.sign(
      { userId: String(authId), email: au.rows[0]?.email, source: 'auth_user' },
      secret,
      { expiresIn: '1h' }
    );
    try {
      const res = await axios.post(
        `${BASE}/services`,
        {
          remark: 'Inverter service / fault',
          message: 'ff',
          warrantyType: 'Annual maintenance service (AMC)',
          cust_id: '1011',
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          validateStatus: () => true,
        }
      );
      console.log(`\nJWT secret "${secret.slice(0, 12)}..." -> ${res.status}`, res.data);
      if (res.status === 201) break;
    } catch (e) {
      console.log('request error:', e.message);
    }
  }

  // Also try login with email if we can find one
  const email = au.rows[0]?.email || au.rows[0]?.username;
  if (email) {
    console.log('\nTry login endpoints for', email, '(password unknown — skip if no argv)');
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e.response?.data || e.message);
  process.exit(1);
});
