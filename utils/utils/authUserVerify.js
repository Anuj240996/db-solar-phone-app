const pool = require('../database/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function verifyDjangoPBKDF2(password, hash) {
  try {
    const parts = hash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const storedHashBase64 = parts[3];
    const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    const derivedHashBase64 = derivedKey.toString('base64');
    let storedBuffer;
    const derivedBuffer = Buffer.from(derivedHashBase64, 'base64');
    try {
      storedBuffer = Buffer.from(storedHashBase64, 'base64');
      if (storedBuffer.length === 0) throw new Error('empty base64');
    } catch (e) {
      try {
        storedBuffer = Buffer.from(storedHashBase64, 'hex');
      } catch (e2) {
        const derivedHex = derivedKey.toString('hex');
        return storedHashBase64 === derivedHex || storedHashBase64 === derivedHashBase64;
      }
    }
    if (storedBuffer.length !== derivedBuffer.length) return false;
    return crypto.timingSafeEqual(storedBuffer, derivedBuffer);
  } catch (_) {
    return false;
  }
}

function isDjangoPBKDF2(hash) {
  if (!hash || typeof hash !== 'string') return false;
  return /^pbkdf2_sha256\$\d+\$[^$]+\$.+$/.test(hash);
}

async function verifyPassword(password, hash) {
  if (!hash || !password) return false;
  try {
    if (typeof password === 'string' && password.normalize) {
      password = password.normalize('NFKC');
    }
  } catch (_) {}
  if (isDjangoPBKDF2(hash)) return verifyDjangoPBKDF2(password, hash);
  try {
    return await bcrypt.compare(password, hash);
  } catch (_) {
    return false;
  }
}

/** Find auth_user by username or email and verify password. Returns { id, username, email } or null. */
async function verifyAuthUserCredentials(username, password) {
  const login = String(username || '').trim();
  const pwd = String(password || '');
  if (!login || !pwd) return null;

  const columnCheck = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'auth_user' AND table_schema = 'public'
  `);
  const availableColumns = columnCheck.rows.map((r) => r.column_name);

  let whereClause = '';
  if (availableColumns.includes('username') && availableColumns.includes('email')) {
    whereClause = 'WHERE username = $1 OR email = $1';
  } else if (availableColumns.includes('username')) {
    whereClause = 'WHERE username = $1';
  } else if (availableColumns.includes('email')) {
    whereClause = 'WHERE email = $1';
  } else {
    return null;
  }

  const selectFields = ['id'];
  if (availableColumns.includes('username')) selectFields.push('username');
  if (availableColumns.includes('email')) selectFields.push('email');
  if (availableColumns.includes('password_hash')) selectFields.push('password_hash');
  else if (availableColumns.includes('password')) selectFields.push('password as password_hash');

  const result = await pool.query(
    `SELECT ${selectFields.join(', ')} FROM auth_user ${whereClause} LIMIT 1`,
    [login]
  );
  if (!result.rows.length) return null;

  const user = result.rows[0];
  const storedHash = user.password_hash || user.password;
  if (!storedHash) return null;

  const isValid = await verifyPassword(pwd, storedHash);
  if (!isValid) return null;

  return {
    id: parseInt(user.id, 10),
    username: user.username || null,
    email: user.email || null,
  };
}

module.exports = {
  verifyPassword,
  verifyAuthUserCredentials,
};
