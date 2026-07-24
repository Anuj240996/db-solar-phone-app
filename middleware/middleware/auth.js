const jwt = require('jsonwebtoken');
const pool = require('../database/db');

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const jwtSource = decoded.source || null;
    const jwtUserId = decoded.userId != null ? String(decoded.userId) : null;
    // Only Associate Login tokens carry role=associate — never rewrite consumer/web sessions
    const isAssociateToken = String(decoded.role || '').toLowerCase() === 'associate';

    console.log('🔐 Authenticating request for userId:', jwtUserId, 'source:', jwtSource || 'unknown');

    const attachJwtMeta = (user) => {
      user.jwt_source = jwtSource;
      user.jwt_user_id = jwtUserId;
      if (decoded.email) user.jwt_email = decoded.email;
      if (decoded.role) {
        user.jwt_role = decoded.role;
        // Apply associate role only for dedicated associate-login JWTs
        if (isAssociateToken) {
          user.role = 'associate';
        } else if (!user.role) {
          user.role = decoded.role;
        }
      }
      return user;
    };

    // Honor login source: user_app tokens must resolve to user_app even if id collides with auth_user
    if (jwtSource === 'user_app' && jwtUserId) {
      try {
        const ua = await pool.query(
          'SELECT id, name, email, phone, role, address, created_at, last_login FROM user_app WHERE id = $1',
          [jwtUserId]
        );
        if (ua.rows.length > 0) {
          req.user = attachJwtMeta(ua.rows[0]);
          req.user.auth_source = 'user_app';
          next();
          return;
        }
      } catch (uaErr) {
        console.error('ΓÜá∩╕Å Error querying user_app (jwt source):', uaErr.message);
      }
    }
    
    // First, check if auth_user table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'auth_user'
      );
    `);

    let availableColumns = [];
    
    if (tableCheck.rows[0].exists) {
      try {
        // Check what columns exist in auth_user table
        const columnCheck = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'auth_user' 
          AND table_schema = 'public'
        `);
        
        availableColumns = columnCheck.rows.map(r => r.column_name);
        console.log('≡ƒôï Available columns in auth_user:', availableColumns.join(', '));
      } catch (columnError) {
        console.error('Γ¥î Error checking auth_user columns:', columnError.message);
        // Continue with empty columns, will fall back to users table
        availableColumns = [];
      }
    } else {
      console.log('ΓÜá∩╕Å auth_user table does not exist, will check users table only');
    }
    
    // Build name field based on available columns
    let nameField = '';
    if (availableColumns.includes('name')) {
      nameField = 'name';
    } else if (availableColumns.includes('first_name') && availableColumns.includes('last_name')) {
      nameField = "TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) as name";
    } else if (availableColumns.includes('first_name')) {
      nameField = 'first_name as name';
    } else if (availableColumns.includes('username')) {
      nameField = 'username as name';
    } else if (availableColumns.includes('email')) {
      nameField = 'email as name';
    } else {
      nameField = "'User' as name";
    }
    
    // Build phone field
    let phoneField = '';
    if (availableColumns.includes('phone')) {
      phoneField = 'phone';
    } else if (availableColumns.includes('phone_number')) {
      phoneField = 'phone_number as phone';
    } else {
      phoneField = "'' as phone";
    }
    
    // Build role field
    let roleField = '';
    if (availableColumns.includes('role')) {
      roleField = 'role';
    } else {
      roleField = "'customer' as role";
    }
    
    // Build address field
    let addressField = '';
    if (availableColumns.includes('address')) {
      addressField = 'address';
    } else {
      addressField = "'' as address";
    }
    
    // Build created_at field
    let createdAtField = '';
    if (availableColumns.includes('created_at')) {
      createdAtField = 'created_at';
    } else if (availableColumns.includes('date_joined')) {
      createdAtField = 'date_joined as created_at';
    } else {
      createdAtField = 'CURRENT_TIMESTAMP as created_at';
    }
    
    // Build email field
    let emailField = '';
    if (availableColumns.includes('email')) {
      emailField = 'email';
    } else {
      emailField = 'NULL as email';
    }
    
    // Build last_login field
    let lastLoginField = '';
    if (availableColumns.includes('last_login')) {
      lastLoginField = 'last_login';
    } else {
      lastLoginField = 'NULL as last_login';
    }

    const staffField = availableColumns.includes('is_staff') ? 'is_staff' : 'NULL as is_staff';
    const usernameField = availableColumns.includes('username') ? 'username' : 'NULL as username';
    
    let result = { rows: [] };
    
    // First, try to get user from auth_user table (if it exists)
    if (tableCheck.rows[0].exists && availableColumns.length > 0) {
      const selectQuery = `
        SELECT 
          id,
          ${nameField},
          ${emailField},
          ${phoneField},
          ${roleField},
          ${addressField},
          ${createdAtField},
          ${lastLoginField},
          ${staffField},
          ${usernameField}
        FROM auth_user 
        WHERE id = $1
      `;
      
      console.log('📝 Querying auth_user with dynamic columns');
      console.log('   Query:', selectQuery);
      
      try {
        result = await pool.query(selectQuery, [decoded.userId]);
      } catch (queryError) {
        console.error('❌ Error querying auth_user:', queryError.message);
        console.error('   Query was:', selectQuery);
        // Continue to try users table
        result = { rows: [] };
      }
    }

    // If not found in auth_user, try user_app table (app-registered users)
    if (result.rows.length === 0) {
      try {
        console.log('≡ƒö╡ Checking user_app table for userId:', decoded.userId);
        const ua = await pool.query(
          'SELECT id, name, email, phone, role, address, created_at, last_login FROM user_app WHERE id = $1',
          [decoded.userId]
        );
        if (ua.rows.length > 0) {
          console.log('Γ£à Found user in user_app table');
          req.user = attachJwtMeta(ua.rows[0]);
          req.user.auth_source = 'user_app';
          next();
          return;
        }
      } catch (uaErr) {
        console.error('ΓÜá∩╕Å Error querying user_app table:', uaErr.message);
      }
    }

    // If not found in auth_user, try users table (for backward compatibility)
    if (result.rows.length === 0) {
      console.log('   User not found in auth_user, checking users table...');
      result = await pool.query(
        'SELECT id, name, email, phone, role, address, created_at, last_login FROM users WHERE id = $1',
        [decoded.userId]
      );
    }

    if (result.rows.length === 0) {
      console.log('Γ¥î User not found in either table');
      return res.status(401).json({ message: 'User not found' });
    }

    const authUser = result.rows[0];
    // mark source for downstream handlers
    authUser.auth_source = 'auth_user';
    // Do NOT promote staff auth_user → associate unless JWT is from /auth/associate-login
    // (keeps consumer phone-app + web Django auth_user sessions unchanged)
    if (isAssociateToken) {
      authUser.role = 'associate';
    } else if (decoded.role && String(decoded.role).toLowerCase() !== 'associate') {
      authUser.role = decoded.role;
    } else if (!authUser.role || authUser.role === 'customer') {
      // auth_user has no real role column in many installs — default customer for /login
      authUser.role = authUser.role || 'customer';
    }
    console.log('✅ User authenticated:', authUser.email || authUser.name, 'role=', authUser.role);
    console.log('   User ID type:', typeof authUser.id, 'Value:', authUser.id);
    
    // Check if ID is an integer (not a UUID)
    // UUIDs contain dashes, integers don't
    const userIdStr = String(authUser.id);
    const isIntegerId = /^\d+$/.test(userIdStr) && !userIdStr.includes('-');
    
    if (isIntegerId) {
      console.log('   User has integer ID from auth_user, looking for UUID in users table...');
      try {
        // Try to find user in users table by email
        if (authUser.email) {
          const usersTableResult = await pool.query(
            'SELECT id, name, email, phone, role, address, created_at, last_login FROM users WHERE email = $1',
            [authUser.email]
          );
          
          if (usersTableResult.rows.length > 0) {
            const usersTableUser = usersTableResult.rows[0];
            console.log('   ✅ Found UUID in users table:', usersTableUser.id);
            if (isAssociateToken) {
              // Associate session: keep JWT role + real auth_user id for scoping
              req.user = attachJwtMeta({
                ...usersTableUser,
                role: 'associate',
                auth_user_id: authUser.id,
                username: authUser.username || usersTableUser.name,
                is_staff: authUser.is_staff,
                auth_source: 'auth_user',
              });
            } else {
              // Consumer / legacy auth_user: previous behaviour — users row role unchanged
              req.user = attachJwtMeta({
                ...usersTableUser,
                auth_source: 'auth_user',
              });
            }
            next();
            return;
          } else {
            console.log('   ⚠️ No matching user found in users table by email:', authUser.email);
          }
        }
        
        // If not found by email, we need to handle this case
        // For now, we'll use the auth_user data but this will cause UUID errors
        console.log('   ⚠️ Warning: Using integer ID which may cause UUID errors in other queries');
        req.user = attachJwtMeta({
          ...authUser,
          id: authUser.id.toString(),
          ...(isAssociateToken ? { auth_user_id: authUser.id } : {}),
          auth_source: 'auth_user',
        });
      } catch (uuidLookupError) {
        console.error('   ❌ Error looking up UUID:', uuidLookupError.message);
        req.user = attachJwtMeta({ ...authUser, auth_source: 'auth_user' });
      }
    } else {
      console.log('   User has UUID, using directly');
      req.user = attachJwtMeta({ ...authUser, auth_source: 'auth_user' });
    }
    
    next();
  } catch (error) {
    console.error('Γ¥î Authentication error:', error.message);
    console.error('Γ¥î Error stack:', error.stack);
    
    // If it's a database/query error, return 500, otherwise 401
    if (error.code && error.code.startsWith('42')) { // PostgreSQL syntax errors
      console.error('Γ¥î SQL syntax error in authentication middleware');
      return res.status(500).json({ 
        message: 'Server error', 
        error: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
    
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    next();
  };
};

module.exports = { authenticate, authorize };

