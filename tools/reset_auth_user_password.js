const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
// Load .env from backend folder (this script lives in backend/tools)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node reset_auth_user_password.js <username_or_email> <newPassword>');
    process.exit(1);
  }
  const [username, newPassword] = args;

  // Debug: ensure DATABASE_URL is loaded
  console.log('🔵 Using DATABASE_URL:', process.env.DATABASE_URL ? '[REDACTED]' : 'undefined');
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Make sure backend/.env exists and contains DATABASE_URL.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: String(process.env.DATABASE_URL),
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const res = await pool.query('UPDATE auth_user SET password = $1 WHERE username = $2 OR email = $2 RETURNING id, username, email', [hash, username]);
    if (res.rows.length === 0) {
      console.error('No auth_user row found for', username);
      process.exit(2);
    }
    console.log('✅ Updated password for user:', res.rows[0]);
  } catch (err) {
    console.error('Error updating password:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

