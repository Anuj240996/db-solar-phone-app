const express = require('express');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');

const router = express.Router();

const USER_APP_FIELDS =
  'id, name, email, phone, role, address, created_at, last_login';

function formatUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    address: row.address,
    created_at: row.created_at,
    last_login: row.last_login,
  };
}

async function loadAppUser(userId) {
  const id = parseInt(userId, 10);
  if (isNaN(id)) return null;
  const result = await pool.query(
    `SELECT ${USER_APP_FIELDS} FROM user_app WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function loadAuthUserProfile(userId) {
  const id = parseInt(userId, 10);
  if (isNaN(id)) return null;

  try {
    const colRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auth_user'
    `);
    const cols = new Set(colRes.rows.map((r) => r.column_name));
    if (!cols.size) return null;

    let nameExpr = "COALESCE(username, email, '') AS name";
    if (cols.has('first_name') || cols.has('last_name')) {
      nameExpr =
        "TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name";
    } else if (cols.has('name')) {
      nameExpr = 'name';
    }

    const phoneExpr = cols.has('phone')
      ? 'phone'
      : cols.has('contact')
        ? 'contact AS phone'
        : 'NULL::text AS phone';

    const addressExpr = cols.has('address')
      ? 'address'
      : 'NULL::text AS address';

    const result = await pool.query(
      `SELECT id, email, ${nameExpr}, ${phoneExpr}, ${addressExpr}
       FROM auth_user WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: 'customer',
      address: row.address,
      created_at: null,
      last_login: null,
    };
  } catch (e) {
    console.warn('loadAuthUserProfile:', e.message);
    return null;
  }
}

async function resolveProfileUser(req) {
  const user = req.user || {};
  if (user.auth_source === 'user_app' && user.id != null) {
    return { table: 'user_app', id: parseInt(user.id, 10), row: user };
  }

  if (user.auth_source === 'auth_user') {
    const authId =
      user.auth_user_id != null
        ? parseInt(user.auth_user_id, 10)
        : parseInt(user.id, 10);
    if (!isNaN(authId)) {
      const row = await loadAuthUserProfile(authId);
      if (row) return { table: 'auth_user', id: authId, row };
    }
  }

  if (user.jwt_source === 'user_app' && user.jwt_user_id != null) {
    const appId = parseInt(user.jwt_user_id, 10);
    if (!isNaN(appId)) {
      const row = await loadAppUser(appId);
      if (row) return { table: 'user_app', id: appId, row };
    }
  }

  return null;
}

// Get user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const resolved = await resolveProfileUser(req);
    if (!resolved?.row) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: formatUser(resolved.row) });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const resolved = await resolveProfileUser(req);
    if (!resolved || isNaN(resolved.id)) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { name, phone, address } = req.body;

    if (resolved.table === 'user_app') {
      const result = await pool.query(
        `UPDATE user_app
         SET name = COALESCE($1, name),
             phone = COALESCE($2, phone),
             address = COALESCE($3, address)
         WHERE id = $4
         RETURNING ${USER_APP_FIELDS}`,
        [
          name != null ? String(name).trim() : null,
          phone != null ? String(phone).trim() : null,
          address != null ? String(address).trim() : null,
          resolved.id,
        ]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: 'User not found' });
      }
      return res.json({
        message: 'Profile updated successfully',
        user: formatUser(result.rows[0]),
      });
    }

    // auth_user — update only columns that exist
    const colRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auth_user'
    `);
    const cols = new Set(colRes.rows.map((r) => r.column_name));
    const sets = [];
    const params = [];
    let i = 1;

    if (name != null && (cols.has('first_name') || cols.has('name'))) {
      if (cols.has('first_name')) {
        const parts = String(name).trim().split(/\s+/);
        sets.push(`first_name = $${i++}`);
        params.push(parts[0] || '');
        if (cols.has('last_name')) {
          sets.push(`last_name = $${i++}`);
          params.push(parts.slice(1).join(' ') || '');
        }
      } else {
        sets.push(`name = $${i++}`);
        params.push(String(name).trim());
      }
    }
    if (phone != null && cols.has('phone')) {
      sets.push(`phone = $${i++}`);
      params.push(String(phone).trim());
    }
    if (address != null && cols.has('address')) {
      sets.push(`address = $${i++}`);
      params.push(String(address).trim());
    }

    if (!sets.length) {
      const row = await loadAuthUserProfile(resolved.id);
      return res.json({
        message: 'Profile updated successfully',
        user: formatUser(row),
      });
    }

    params.push(resolved.id);
    await pool.query(
      `UPDATE auth_user SET ${sets.join(', ')} WHERE id = $${i}`,
      params
    );
    const row = await loadAuthUserProfile(resolved.id);
    return res.json({
      message: 'Profile updated successfully',
      user: formatUser(row),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      message:
        process.env.NODE_ENV === 'development'
          ? error.message || 'Server error'
          : 'Server error',
    });
  }
});

module.exports = router;
