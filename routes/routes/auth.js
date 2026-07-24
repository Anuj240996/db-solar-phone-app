const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../database/db');
const { authenticate } = require('../middleware/auth');
const {
  checkAppAuthLinkConflict,
  APP_AUTH_LINK_MESSAGES,
  resolveLinkAppUserId,
} = require('../utils/appAccess');
const { buildProjectsForAuthUserId } = require('../utils/projectBuilders');
const { sendPasswordResetOtp } = require('../utils/mailer');

const router = express.Router();

/** email(lower) -> { otpHash, userId, source, expiresAt } */
const passwordResetOtps = new Map();

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

async function findAccountForPasswordReset(email) {
  const normalized = String(email || '').trim();
  if (!normalized) return null;

  try {
    const ua = await pool.query(
      `SELECT id, name, email FROM user_app
       WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
       LIMIT 1`,
      [normalized]
    );
    if (ua.rows.length > 0) {
      return {
        userId: ua.rows[0].id,
        name: ua.rows[0].name,
        email: ua.rows[0].email || normalized,
        source: 'user_app',
      };
    }
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }

  const authUser = await findAuthUserByLogin(normalized);
  if (!authUser) return null;

  const displayName =
    [authUser.first_name, authUser.last_name].filter(Boolean).join(' ').trim() ||
    authUser.username ||
    authUser.email ||
    'User';

  return {
    userId: authUser.id,
    name: displayName,
    email: authUser.email || normalized,
    source: 'auth_user',
  };
}

async function updateAccountPassword(source, userId, passwordHash) {
  if (source === 'user_app') {
    await pool.query('UPDATE user_app SET password_hash = $1 WHERE id = $2', [
      passwordHash,
      userId,
    ]);
    return;
  }

  if (source === 'auth_user') {
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auth_user'
        AND column_name IN ('password', 'password_hash')
    `);
    const cols = columnCheck.rows.map((r) => r.column_name);
    if (cols.includes('password')) {
      await pool.query('UPDATE auth_user SET password = $1 WHERE id = $2', [
        passwordHash,
        userId,
      ]);
    } else if (cols.includes('password_hash')) {
      await pool.query('UPDATE auth_user SET password_hash = $1 WHERE id = $2', [
        passwordHash,
        userId,
      ]);
    } else {
      throw new Error('auth_user has no password column');
    }
    return;
  }

  throw new Error(`Unsupported auth source: ${source}`);
}

// Helper function to verify Django PBKDF2 password
// Format: pbkdf2_sha256$<iterations>$<salt>$<hash>
function verifyDjangoPBKDF2(password, hash) {
  try {
    // Parse Django PBKDF2 hash format: pbkdf2_sha256$<iterations>$<salt>$<hash>
    const parts = hash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
      return false;
    }

    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const storedHashBase64 = parts[3];

    // Derive the key using PBKDF2 (32 bytes = 256 bits)
    const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');

    // Base64 encode the derived key
    const derivedHashBase64 = derivedKey.toString('base64');

    // Compare base64 strings directly (they should be the same)
    // Use timing-safe comparison by comparing buffers
    let storedBuffer;
    let derivedBuffer = Buffer.from(derivedHashBase64, 'base64');

    // Try interpreting stored hash as base64 first, then hex as fallback
    try {
      storedBuffer = Buffer.from(storedHashBase64, 'base64');
      if (storedBuffer.length === 0) throw new Error('empty base64');
    } catch (e) {
      try {
        // fallback: stored as hex
        storedBuffer = Buffer.from(storedHashBase64, 'hex');
      } catch (e2) {
        // Last resort: compare string forms
        const derivedHex = derivedKey.toString('hex');
        // Log mismatch details in development to help debugging
        if (process.env.NODE_ENV !== 'production') {
          console.log('≡ƒöì PBKDF2 compare fallback string forms');
          console.log('   storedHash (raw):', storedHashBase64);
          console.log('   derivedHashBase64:', derivedHashBase64);
          console.log('   derivedHex:', derivedHex);
        }
        return storedHashBase64 === derivedHex || storedHashBase64 === derivedHashBase64;
      }
    }

    // Ensure buffers are same length for timing-safe comparison
    if (storedBuffer.length !== derivedBuffer.length) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('≡ƒöì PBKDF2 length mismatch');
        console.log('   storedBuffer.length:', storedBuffer.length);
        console.log('   derivedBuffer.length:', derivedBuffer.length);
        try {
          console.log('   stored (base64):', Buffer.from(storedBuffer).toString('base64'));
        } catch (_) {}
        try {
          console.log('   derived (base64):', derivedBuffer.toString('base64'));
        } catch (_) {}
      }
      return false;
    }

    const equal = crypto.timingSafeEqual(storedBuffer, derivedBuffer);
    if (!equal && process.env.NODE_ENV !== 'production') {
      try {
        console.log('≡ƒöì PBKDF2 mismatch details:');
        console.log('   storedHash (raw):', storedHashBase64);
        console.log('   derivedHashBase64:', derivedHashBase64);
        console.log('   storedHex:', Buffer.from(storedBuffer).toString('hex'));
        console.log('   derivedHex:', derivedBuffer.toString('hex'));
      } catch (_) {}
    }
    return equal;
  } catch (error) {
    console.error('Error verifying Django PBKDF2 password:', error);
    return false;
  }
}

// Helper function to check if password hash is Django PBKDF2 format
function isDjangoPBKDF2(hash) {
  if (!hash || typeof hash !== 'string') return false;
  // Django PBKDF2 format: pbkdf2_sha256$<iterations>$<salt>$<hash>
  return /^pbkdf2_sha256\$\d+\$[^$]+\$.+$/.test(hash);
}

// Helper function to verify password (supports both bcrypt and Django PBKDF2)
async function verifyPassword(password, hash) {
  if (!hash || !password) return false;

  // Normalize password using NFKC to match Django's normalization
  try {
    if (typeof password === 'string' && password.normalize) {
      password = password.normalize('NFKC');
    }
  } catch (normErr) {
    console.warn('ΓÜá∩╕Å Password normalization failed:', normErr.message);
  }

  // Check if it's Django PBKDF2 format
  if (isDjangoPBKDF2(hash)) {
    const ok = verifyDjangoPBKDF2(password, hash);
    console.log('≡ƒöÉ verifyPassword: Django PBKDF2 result =', ok);
    return ok;
  }

  // Otherwise, assume it's bcrypt
  try {
    const ok = await bcrypt.compare(password, hash);
    console.log('≡ƒöÉ verifyPassword: bcrypt result =', ok);
    return ok;
  } catch (e) {
    console.warn('ΓÜá∩╕Å verifyPassword bcrypt compare error:', e.message);
    return false;
  }
}

// Register
router.post('/signup', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, phone, password, address, role: roleRaw } = req.body;
    const trimmedName = String(name || '').trim();
    const requestedRole = String(roleRaw || 'customer').trim().toLowerCase();
    const isAssociate =
      requestedRole === 'associate' ||
      requestedRole === 'aso' ||
      trimmedName.toLowerCase().startsWith('aso_');
    const role = isAssociate ? 'associate' : 'customer';

    // Check if user exists
    // Ensure email uniqueness across user_app table
    const existingUser = await pool.query(
      'SELECT id FROM user_app WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user ΓÇö role customer (default) or associate (aso_ / role body)
    const result = await pool.query(
      `INSERT INTO user_app (name, email, phone, password_hash, address, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, role, address, created_at`,
      [trimmedName, email, phone, passwordHash, address || null, role]
    );

    const user = result.rows[0];
    console.log(`Γ£à user_app created: id=${user.id}, name="${user.name}", email=${user.email}`);

    // Update last login for user_app (was previously updating users table)
    try {
      await pool.query(
        'UPDATE user_app SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );
    } catch (updateErr) {
      console.warn('ΓÜá∩╕Å Could not update last_login in user_app:', updateErr.message);
    }

    // Generate token ΓÇö source: user_app avoids id collision with auth_user in middleware
    const token = jwt.sign(
      { userId: String(user.id), email: user.email, source: 'user_app' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        address: user.address,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

async function findAuthUserByLogin(username) {
  const columnCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auth_user'
  `);
  const cols = columnCheck.rows.map((r) => r.column_name);
  if (cols.length === 0) return null;

  let whereClause = '';
  if (cols.includes('username') && cols.includes('email')) {
    whereClause =
      'WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) OR LOWER(TRIM(email)) = LOWER(TRIM($1))';
  } else if (cols.includes('email')) {
    whereClause = 'WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))';
  } else if (cols.includes('username')) {
    whereClause = 'WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))';
  } else {
    return null;
  }

  const selectFields = ['id'];
  if (cols.includes('username')) selectFields.push('username');
  if (cols.includes('email')) selectFields.push('email');
  if (cols.includes('first_name')) selectFields.push('first_name');
  if (cols.includes('last_name')) selectFields.push('last_name');
  if (cols.includes('is_staff')) selectFields.push('is_staff');
  if (cols.includes('password_hash')) selectFields.push('password_hash');
  else if (cols.includes('password')) selectFields.push('password as password_hash');

  const q = `SELECT ${selectFields.join(', ')} FROM auth_user ${whereClause} LIMIT 1`;
  const result = await pool.query(q, [username.trim()]);
  return result.rows[0] || null;
}

function buildLoginResponse(token, user) {
  return {
    success: true,
    message: 'Login successful',
    data: { token, user },
  };
}

function bitFlagTrue(value) {
  if (value === true || value === 1) return true;
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 't' || s === 'yes';
}

function isStaffAuthUser(authUser) {
  if (!authUser) return false;
  const username = String(authUser.username || '').trim().toLowerCase();
  if (username.startsWith('db_')) return false;
  if (username.startsWith('aso_')) return true;
  return bitFlagTrue(authUser.is_staff);
}

/**
 * Associate-only login: verify username/password against auth_user (staff).
 * Does not change consumer POST /login.
 */
router.post('/associate-login', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'Server misconfiguration: JWT_SECRET is missing.',
      });
    }

    const loginId = String(req.body.username || '').trim();
    const password = req.body.password;
    console.log('🔵 Associate login attempt for:', loginId);

    const authUser = await findAuthUserByLogin(loginId);
    if (!authUser || !isStaffAuthUser(authUser)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid associate credentials. Use your staff username from auth_user.',
      });
    }

    const storedHash =
      authUser.password_hash || authUser.password || authUser.passwordHash;
    if (!storedHash) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, storedHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const displayName =
      [authUser.first_name, authUser.last_name].filter(Boolean).join(' ').trim() ||
      authUser.username ||
      authUser.email ||
      loginId;

    const token = jwt.sign(
      {
        userId: String(authUser.id),
        email: authUser.email || loginId,
        source: 'auth_user',
        role: 'associate',
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    console.log('✅ Associate login ok auth_user id=', authUser.id, authUser.username);
    return res.json(
      buildLoginResponse(token, {
        id: authUser.id,
        name: displayName,
        email: authUser.email || loginId,
        phone: '',
        role: 'associate',
        address: '',
        username: authUser.username || null,
      })
    );
  } catch (error) {
    console.error('❌ Associate login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// App Login: user_app first, then auth_user (legacy/Django accounts)
router.post('/login', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    if (!process.env.JWT_SECRET) {
      console.error('Γ¥î Login failed: JWT_SECRET is not set in environment');
      return res.status(500).json({
        success: false,
        message: 'Server misconfiguration: JWT_SECRET is missing. Set it in backend .env and restart.',
      });
    }

    const { username, password } = req.body;
    const loginId = String(username).trim();
    console.log('≡ƒö╡ App login attempt for:', loginId);

    // 1) user_app (app signup / bcrypt password_hash)
    try {
      const uaQuery = await pool.query(
        `SELECT id, name, email, phone, password_hash, role, address, created_at, last_login
         FROM user_app
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
         LIMIT 1`,
        [loginId]
      );

      if (uaQuery.rows.length > 0) {
        const uaUser = uaQuery.rows[0];
        let valid = false;
        if (uaUser.password_hash) {
          try {
            valid = await bcrypt.compare(password, uaUser.password_hash);
          } catch (bcErr) {
            console.error('Γ¥î bcrypt.compare error for user_app:', bcErr.message);
            return res.status(500).json({
              success: false,
              message: 'Invalid password format stored for this account. Reset password on server.',
            });
          }
        }
        if (!valid) {
          return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        try {
          await pool.query('UPDATE user_app SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [
            uaUser.id,
          ]);
        } catch (e) {
          console.warn('Could not update user_app.last_login:', e.message);
        }

        const token = jwt.sign(
          { userId: String(uaUser.id), email: uaUser.email, source: 'user_app' },
          process.env.JWT_SECRET,
          { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        let role = uaUser.role || 'customer';
        const nameLower = String(uaUser.name || '').trim().toLowerCase();
        const emailLower = String(uaUser.email || '').trim().toLowerCase();
        if (
          role === 'associate' ||
          nameLower.startsWith('aso_') ||
          emailLower.startsWith('aso_')
        ) {
          role = 'associate';
        }

        return res.json(
          buildLoginResponse(token, {
            id: uaUser.id,
            name: uaUser.name,
            email: uaUser.email,
            phone: uaUser.phone,
            role,
            address: uaUser.address,
            createdAt: uaUser.created_at,
          })
        );
      }
    } catch (uaErr) {
      if (uaErr.code === '42P01') {
        console.warn('ΓÜá∩╕Å user_app table missing; trying auth_user login only');
      } else {
        throw uaErr;
      }
    }

    // 2) auth_user (Django / staff accounts ΓÇö e.g. anuj@gmail.com may exist only here)
    const authUser = await findAuthUserByLogin(loginId);
    if (!authUser) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const storedHash =
      authUser.password_hash || authUser.password || authUser.passwordHash;
    if (!storedHash) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const authValid = await verifyPassword(password, storedHash);
    if (!authValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const displayName =
      [authUser.first_name, authUser.last_name].filter(Boolean).join(' ').trim() ||
      authUser.username ||
      authUser.email ||
      'User';

    const loginLower = String(loginId || '').trim().toLowerCase();
    const usernameLower = String(authUser.username || '').trim().toLowerCase();
    const authRole =
      loginLower.startsWith('aso_') || usernameLower.startsWith('aso_')
        ? 'associate'
        : 'customer';

    const token = jwt.sign(
      {
        userId: String(authUser.id),
        email: authUser.email || loginId,
        source: 'auth_user',
        role: authRole,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json(
      buildLoginResponse(token, {
        id: authUser.id,
        name: displayName,
        email: authUser.email || loginId,
        phone: '',
        role: authRole,
        address: '',
      })
    );
  } catch (error) {
    console.error('Γ¥î Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      code: error.code,
    });
  }
});

// Verify credentials against auth_user table and fetch that user's projects (customers)
router.post('/verify-fetch-projects', authenticate, [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    // Query auth_user table for username/email
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'auth_user' 
      AND table_schema = 'public'
    `);
    const availableColumns = columnCheck.rows.map(r => r.column_name);

    let whereClause = '';
    if (availableColumns.includes('username') && availableColumns.includes('email')) {
      whereClause = 'WHERE username = $1 OR email = $1';
    } else if (availableColumns.includes('username')) {
      whereClause = 'WHERE username = $1';
    } else if (availableColumns.includes('email')) {
      whereClause = 'WHERE email = $1';
    } else {
      return res.status(400).json({ message: 'auth_user table structure not supported' });
    }

    const selectFields = ['id', availableColumns.includes('username') ? 'username as name' : "'User' as name"];
    if (availableColumns.includes('email')) selectFields.push('email');
    if (availableColumns.includes('password_hash')) selectFields.push('password_hash');
    else if (availableColumns.includes('password')) selectFields.push('password as password_hash');

    const selectQuery = `SELECT ${selectFields.join(', ')} FROM auth_user ${whereClause}`;
    console.log('≡ƒô¥ verify-fetch-projects request body:', req.body);
    console.log('≡ƒô¥ Auth select query:', selectQuery);
    let result;
    try {
      result = await pool.query(selectQuery, [username]);
    } catch (queryErr) {
      console.error('Γ¥î SQL error on auth_user query:', queryErr.message);
      return res.status(500).json({ message: 'Server error' });
    }

    console.log('≡ƒôè auth_user rows:', result.rows.length);
    if (result.rows.length === 0) {
      console.log('ΓÜá∩╕Å No auth_user found for username/email:', username);
      return res.status(401).json({ success: false, message: 'Invalid credentials', reason: 'user-not-found' });
    }

    const user = result.rows[0];
    // Verify password (bcrypt) - support different column names
    const storedHash = user.password_hash || user.password || user.passwordHash || user.passwordHash;
    if (!storedHash) {
      console.log('Γ¥î No password hash found on auth_user record for id:', user.id);
      return res.status(401).json({ success: false, message: 'Invalid credentials', reason: 'no-password-hash' });
    }

    // Use verifyPassword helper which supports bcrypt and Django PBKDF2
    const isValid = await verifyPassword(password, storedHash);
    console.log('≡ƒöÉ verifyPassword result =', isValid);
    if (!isValid) {
      console.log('Γ¥î Password verification failed for auth_user id:', user.id);
      return res.status(401).json({ success: false, message: 'Invalid credentials', reason: 'password-mismatch' });
    }

    // Link mobile app user to verified auth_user ΓÇö do not copy customer rows.
    const linkAppUserId = await resolveLinkAppUserId(req);
    if (!linkAppUserId) {
      return res.status(401).json({
        success: false,
        message: 'Could not identify your app account. Please log out and sign in again.',
        reason: 'no-app-user-id',
      });
    }

    const linkConflict = await checkAppAuthLinkConflict(linkAppUserId, user.id);
    if (linkConflict === 'other') {
      return res.status(409).json({
        success: false,
        message: APP_AUTH_LINK_MESSAGES.other,
        reason: 'already_linked_other',
      });
    }

    if (linkConflict !== 'own') {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS app_auth_links (
            id BIGSERIAL PRIMARY KEY,
            app_user_id BIGINT NOT NULL,
            auth_user_id BIGINT NOT NULL,
            token TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (app_user_id, auth_user_id)
          )
        `);
        await pool.query(
          `INSERT INTO app_auth_links (app_user_id, auth_user_id, token)
           VALUES ($1, $2, $3)
           ON CONFLICT (app_user_id, auth_user_id) DO UPDATE
             SET created_at = CURRENT_TIMESTAMP`,
          [linkAppUserId, user.id, null]
        );
        console.log(`Γ£à app_auth_links: app_user_id=${linkAppUserId} auth_user_id=${user.id}`);
      } catch (linkErr) {
        console.error('Γ¥î verify-fetch-projects link upsert failed:', linkErr.message);
        return res.status(500).json({
          success: false,
          message: 'Credentials verified but account could not be linked',
          reason: 'link-upsert-failed',
          detail: process.env.NODE_ENV === 'development' ? linkErr.message : undefined,
        });
      }
    } else {
      console.log(`Γä╣∩╕Å verify-fetch-projects: already linked app_user_id=${linkAppUserId} auth_user_id=${user.id}`);
    }

    const projects = await buildProjectsForAuthUserId(user.id);

    res.json({
      success: true,
      message:
        linkConflict === 'own'
          ? APP_AUTH_LINK_MESSAGES.own
          : 'Account linked and projects fetched',
      alreadyLinked: linkConflict === 'own',
      data: { projects, linkedAuthUserId: user.id },
    });
  } catch (error) {
    console.error('Γ¥î verify-fetch-projects error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot Password ΓÇö emails a 6-digit OTP (user_app or auth_user)
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const email = String(req.body.email || '').trim();
    const account = await findAccountForPasswordReset(email);

    // Always return the same message when no account (prevent email enumeration)
    if (!account) {
      return res.json({
        success: true,
        message:
          'If an account exists with this email, a password reset code has been sent.',
      });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    passwordResetOtps.set(String(account.email).toLowerCase(), {
      otpHash: hashOtp(otp),
      userId: account.userId,
      source: account.source,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    try {
      await sendPasswordResetOtp({
        to: account.email,
        name: account.name,
        otp,
      });
    } catch (mailErr) {
      passwordResetOtps.delete(String(account.email).toLowerCase());
      console.error('Forgot password email error:', mailErr.message);
      return res.status(503).json({
        success: false,
        message:
          mailErr.code === 'SMTP_NOT_CONFIGURED'
            ? 'Email service is not configured on the server. Contact support.'
            : 'Failed to send reset email. Please try again later.',
      });
    }

    return res.json({
      success: true,
      message: 'If an account exists with this email, a password reset code has been sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Reset Password ΓÇö email + OTP (preferred) or legacy JWT token
router.post('/reset-password', [
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, email, otp, password } = req.body;
    let userId;
    let source;

    if (email && otp) {
      const key = String(email).trim().toLowerCase();
      const entry = passwordResetOtps.get(key);
      if (!entry || entry.expiresAt < Date.now()) {
        passwordResetOtps.delete(key);
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset code',
        });
      }
      if (entry.otpHash !== hashOtp(String(otp).trim())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset code',
        });
      }
      userId = entry.userId;
      source = entry.source;
      passwordResetOtps.delete(key);
    } else if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type !== 'password-reset') {
        return res.status(400).json({ success: false, message: 'Invalid token' });
      }
      userId = decoded.userId;
      source = decoded.source || 'user_app';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await updateAccountPassword(source, userId, passwordHash);

    res.json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(400).json({
      success: false,
      message: 'Invalid or expired reset code',
    });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

// Update profile for app (user_app) or Django (auth_user) accounts
router.put('/profile', authenticate, async (req, res) => {
  try {
    const user = req.user || {};
    const { name, phone, address } = req.body;

    // user_app session
    const appId =
      user.auth_source === 'user_app' && user.id != null
        ? parseInt(user.id, 10)
        : user.jwt_source === 'user_app' && user.jwt_user_id != null
          ? parseInt(user.jwt_user_id, 10)
          : NaN;

    if (!isNaN(appId)) {
      const result = await pool.query(
        `UPDATE user_app
         SET name = COALESCE($1, name),
             phone = COALESCE($2, phone),
             address = COALESCE($3, address)
         WHERE id = $4
         RETURNING id, name, email, phone, role, address, created_at, last_login`,
        [
          name != null ? String(name).trim() : null,
          phone != null ? String(phone).trim() : null,
          address != null ? String(address).trim() : null,
          appId,
        ]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: 'User not found' });
      }
      return res.json({
        message: 'Profile updated successfully',
        user: result.rows[0],
      });
    }

    // auth_user session (Django login ΓÇö most production users)
    const authId =
      user.auth_source === 'auth_user' && user.id != null
        ? parseInt(user.id, 10)
        : user.auth_user_id != null
          ? parseInt(user.auth_user_id, 10)
          : NaN;

    if (isNaN(authId)) {
      return res.status(400).json({ message: 'Could not identify user for profile update' });
    }

    const nameVal = name != null ? String(name).trim() : null;
    const phoneVal = phone != null ? String(phone).trim() : null;
    const addressVal = address != null ? String(address).trim() : null;

    // Update user_profile if row exists (customer_id = auth_user.id)
    const profileRes = await pool.query(
      `UPDATE user_profile
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           address = COALESCE($3, address)
       WHERE customer_id = $4
       RETURNING customer_id, name, phone, address`,
      [nameVal, phoneVal, addressVal, authId]
    );

    if (profileRes.rows.length > 0) {
      const p = profileRes.rows[0];
      return res.json({
        message: 'Profile updated successfully',
        user: {
          id: authId,
          name: p.name || nameVal || user.name,
          email: user.email,
          phone: p.phone || phoneVal,
          role: user.role || 'customer',
          address: p.address || addressVal,
        },
      });
    }

    // No user_profile row ΓÇö update auth_user name fields when possible
    const colRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auth_user'
    `);
    const cols = new Set(colRes.rows.map((r) => r.column_name));
    const sets = [];
    const params = [];
    let i = 1;

    if (nameVal && cols.has('first_name')) {
      const parts = nameVal.split(/\s+/);
      sets.push(`first_name = $${i++}`);
      params.push(parts[0] || '');
      if (cols.has('last_name')) {
        sets.push(`last_name = $${i++}`);
        params.push(parts.slice(1).join(' ') || '');
      }
    }

    if (sets.length) {
      params.push(authId);
      await pool.query(
        `UPDATE auth_user SET ${sets.join(', ')} WHERE id = $${i}`,
        params
      );
    }

    return res.json({
      message: 'Profile updated successfully',
      user: {
        id: authId,
        name: nameVal || user.name,
        email: user.email,
        phone: phoneVal || user.phone,
        role: user.role || 'customer',
        address: addressVal || user.address,
      },
    });
  } catch (error) {
    console.error('Auth profile update error:', error);
    res.status(500).json({
      message:
        process.env.NODE_ENV === 'development'
          ? error.message || 'Server error'
          : 'Server error',
    });
  }
});

module.exports = router;

