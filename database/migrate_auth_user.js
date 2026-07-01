// Load environment variables FIRST, before requiring db
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Enhanced migration script to sync data from auth_user to users table
 * 
 * Features:
 * - Properly handles Django PBKDF2 passwords (keeps them as-is)
 * - Handles plain text passwords (hashes with bcrypt)
 * - Handles already bcrypt hashed passwords
 * - Maps all common fields correctly
 * - Generates UUID for users table (different from auth_user bigint ID)
 * - Maps username/email, first_name/last_name to name
 * - Handles role based on is_superuser/is_staff flags
 * - Creates trigger for automatic sync on new inserts/updates
 */

// Validate database connection before creating pool
function validateAndCreatePool() {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.error('❌ Error: DATABASE_URL is not set in .env file');
    console.error('   Please add DATABASE_URL to backend/.env');
    console.error('   Format: DATABASE_URL=postgresql://username:password@localhost:5432/db_solar');
    console.error(`   Looking for .env at: ${path.join(__dirname, '..', '.env')}`);
    process.exit(1);
  }

  // Parse the connection string to validate it
  try {
    const url = new URL(dbUrl);
    
    // Check if password is present
    if (!url.password || url.password.trim() === '') {
      console.error('❌ Error: Password is missing in DATABASE_URL');
      console.error('   Current value:', dbUrl.replace(/:[^:@]+@/, ':****@'));
      console.error('   Format: postgresql://username:password@localhost:5432/db_solar');
      console.error('   If your password has special characters, URL encode them:');
      console.error('   - @ becomes %40');
      console.error('   - : becomes %3A');
      console.error('   - / becomes %2F');
      console.error('   - # becomes %23');
      process.exit(1);
    }

    console.log('✅ Database configuration validated');
    console.log(`   Database: ${url.pathname.substring(1)}`);
    console.log(`   Host: ${url.hostname}:${url.port || 5432}\n`);

    // Create pool with validated connection string
    const pool = new Pool({
      connectionString: dbUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
      process.exit(-1);
    });

    return pool;
  } catch (error) {
    console.error('❌ Error: DATABASE_URL format is incorrect');
    console.error('   Current value:', dbUrl);
    console.error('   Error:', error.message);
    console.error('   Expected format: postgresql://username:password@localhost:5432/db_solar');
    process.exit(1);
  }
}

// Helper function to check if password is Django PBKDF2 format
function isDjangoPBKDF2(password) {
  if (!password || typeof password !== 'string') return false;
  // Django PBKDF2 format: pbkdf2_sha256$<iterations>$<salt>$<hash>
  return /^pbkdf2_sha256\$\d+\$[^$]+\$.+$/.test(password);
}

// Helper function to check if password is already hashed (bcrypt format)
function isBcryptHashed(password) {
  if (!password || typeof password !== 'string') return false;
  // Bcrypt hashes start with $2a$, $2b$, $2y$, or $2x$ and are 60 chars long
  return /^\$2[aybx]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(password);
}

// Helper function to detect password format and prepare for storage
async function processPassword(password) {
  if (!password || typeof password !== 'string' || password.trim() === '') {
    return null;
  }

  // If it's already Django PBKDF2, keep it as-is
  // (Users will login with the same password via Django PBKDF2 verification in login route)
  if (isDjangoPBKDF2(password)) {
    console.log('   ✓ Django PBKDF2 password detected - keeping as-is');
    return password;
  }

  // If it's already bcrypt, keep it as-is
  if (isBcryptHashed(password)) {
    console.log('   ✓ Bcrypt password detected - keeping as-is');
    return password;
  }

  // Otherwise, it's plain text - hash it with bcrypt
  console.log('   ✓ Plain text password detected - hashing with bcrypt');
  return await bcrypt.hash(password, 10);
}

async function migrateAuthUserToUsers() {
  // Create pool after validation
  const pool = validateAndCreatePool();

  try {
    console.log('🚀 Starting auth_user to users migration...\n');

    // Step 1: Check if auth_user table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'auth_user'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ auth_user table does not exist. Skipping migration.');
      await pool.end();
      process.exit(0);
    }

    console.log('✅ auth_user table found\n');

    // Step 2: Get column information from both tables
    const authUserColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'auth_user' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    const usersColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    const authUserCols = authUserColumns.rows.map(r => r.column_name);
    const usersCols = usersColumns.rows.map(r => r.column_name);

    console.log('📋 auth_user columns:', authUserCols.join(', '));
    console.log('📋 users columns:', usersCols.join(', '));
    console.log('');

    // Step 3: Detect available fields in auth_user
    const hasUsername = authUserCols.includes('username');
    const hasEmail = authUserCols.includes('email');
    const hasFirstName = authUserCols.includes('first_name');
    const hasLastName = authUserCols.includes('last_name');
    const hasPassword = authUserCols.includes('password');
    const hasPhone = authUserCols.includes('phone') || authUserCols.includes('phone_number') || authUserCols.includes('mobile');
    const hasDateJoined = authUserCols.includes('date_joined');
    const hasLastLogin = authUserCols.includes('last_login');
    const hasIsSuperuser = authUserCols.includes('is_superuser');
    const hasIsStaff = authUserCols.includes('is_staff');
    const hasAddress = authUserCols.includes('address');

    console.log('🔍 Detected fields in auth_user:');
    console.log(`   - username: ${hasUsername ? '✅' : '❌'}`);
    console.log(`   - email: ${hasEmail ? '✅' : '❌'}`);
    console.log(`   - first_name: ${hasFirstName ? '✅' : '❌'}`);
    console.log(`   - last_name: ${hasLastName ? '✅' : '❌'}`);
    console.log(`   - password: ${hasPassword ? '✅' : '❌'}`);
    console.log(`   - phone: ${hasPhone ? '✅' : '❌'}`);
    console.log(`   - date_joined: ${hasDateJoined ? '✅' : '❌'}`);
    console.log(`   - last_login: ${hasLastLogin ? '✅' : '❌'}`);
    console.log(`   - is_superuser: ${hasIsSuperuser ? '✅' : '❌'}`);
    console.log(`   - is_staff: ${hasIsStaff ? '✅' : '❌'}`);
    console.log(`   - address: ${hasAddress ? '✅' : '❌'}`);
    console.log('');

    // Step 4: Create trigger function for automatic sync
    // Note: Trigger will store password as-is (Django or plain text)
    // Password hashing/verification will be handled in login route
    console.log('🔧 Creating trigger function for automatic sync...');

    // Build SQL expressions for trigger
    let emailExpr = "COALESCE(NEW.email, NEW.username, '')";
    if (!hasEmail && hasUsername) {
      emailExpr = "COALESCE(NEW.username, '')";
    } else if (hasEmail && !hasUsername) {
      emailExpr = "COALESCE(NEW.email, '')";
    }

    let nameExpr = "'User'";
    if (hasFirstName && hasLastName) {
      nameExpr = `TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''))`;
    } else if (hasFirstName) {
      nameExpr = "COALESCE(NEW.first_name, 'User')";
    } else if (hasLastName) {
      nameExpr = "COALESCE(NEW.last_name, 'User')";
    } else if (hasUsername) {
      nameExpr = "COALESCE(NEW.username, 'User')";
    }

    let phoneExpr = "''";
    if (hasPhone) {
      const phoneField = authUserCols.find(col => ['phone', 'phone_number', 'mobile'].includes(col));
      if (phoneField) {
        phoneExpr = `COALESCE(NEW.${phoneField}::text, '')`;
      }
    }

    let passwordExpr = "''";
    if (hasPassword) {
      passwordExpr = "COALESCE(NEW.password, '')";
    }

    let roleExpr = "'customer'";
    if (hasIsSuperuser || hasIsStaff) {
      roleExpr = `CASE 
        WHEN ${hasIsSuperuser ? "NEW.is_superuser::text = '1'" : 'false'} THEN 'admin'
        WHEN ${hasIsStaff ? "NEW.is_staff::text = '1'" : 'false'} THEN 'admin'
        ELSE 'customer'
      END`;
    }

    let addressExpr = "''";
    if (hasAddress) {
      addressExpr = "COALESCE(NEW.address, '')";
    }

    let createdAtExpr = 'CURRENT_TIMESTAMP';
    if (hasDateJoined) {
      createdAtExpr = `CASE 
        WHEN NEW.date_joined IS NULL OR NEW.date_joined = '' THEN CURRENT_TIMESTAMP
        ELSE NEW.date_joined::timestamp
      END`;
    }

    let lastLoginExpr = 'NULL';
    if (hasLastLogin) {
      lastLoginExpr = `CASE 
        WHEN NEW.last_login IS NULL OR NEW.last_login = '' THEN NULL
        ELSE NEW.last_login::timestamp
      END`;
    }

    const triggerFunctionSQL = `
      CREATE OR REPLACE FUNCTION sync_auth_user_to_users()
      RETURNS TRIGGER AS $$
      DECLARE
        v_password_hash TEXT;
        v_email TEXT;
      BEGIN
        -- Get email (prefer email, fallback to username)
        v_email := ${emailExpr};
        
        -- Skip if email is empty
        IF v_email = '' OR v_email IS NULL THEN
          RAISE NOTICE 'Skipping sync: email/username is empty';
          RETURN NEW;
        END IF;

        -- Get password (will be processed in application layer)
        v_password_hash := ${passwordExpr};

        -- Insert or update in users table
        INSERT INTO users (
          name,
          email,
          phone,
          password_hash,
          role,
          address,
          created_at,
          last_login,
          updated_at
        )
        VALUES (
          ${nameExpr},
          v_email,
          ${phoneExpr},
          v_password_hash,
          ${roleExpr},
          ${addressExpr},
          ${createdAtExpr},
          ${lastLoginExpr},
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (email) 
        DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          address = EXCLUDED.address,
          last_login = EXCLUDED.last_login,
          updated_at = CURRENT_TIMESTAMP;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `;

    await pool.query(triggerFunctionSQL);
    console.log('✅ Trigger function created\n');

    // Step 5: Create trigger
    await pool.query(`
      DROP TRIGGER IF EXISTS trigger_sync_auth_user_to_users ON auth_user;
    `);

    await pool.query(`
      CREATE TRIGGER trigger_sync_auth_user_to_users
      AFTER INSERT OR UPDATE ON auth_user
      FOR EACH ROW
      EXECUTE FUNCTION sync_auth_user_to_users();
    `);

    console.log('✅ Trigger created for automatic sync\n');

    // Step 6: Build SELECT query for existing data migration
    let selectEmail = "COALESCE(email, username, '')";
    if (!hasEmail && hasUsername) {
      selectEmail = "COALESCE(username, '')";
    } else if (hasEmail && !hasUsername) {
      selectEmail = "COALESCE(email, '')";
    }

    let selectName = "'User'";
    if (hasFirstName && hasLastName) {
      selectName = `TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))`;
    } else if (hasFirstName) {
      selectName = "COALESCE(first_name, 'User')";
    } else if (hasLastName) {
      selectName = "COALESCE(last_name, 'User')";
    } else if (hasUsername) {
      selectName = "COALESCE(username, 'User')";
    }

    let selectPhone = "''";
    if (hasPhone) {
      const phoneField = authUserCols.find(col => ['phone', 'phone_number', 'mobile'].includes(col));
      if (phoneField) {
        selectPhone = `COALESCE(${phoneField}::text, '')`;
      }
    }

    let selectPassword = "''";
    if (hasPassword) {
      selectPassword = "COALESCE(password, '')";
    }

    let selectRole = "'customer'";
    if (hasIsSuperuser || hasIsStaff) {
      selectRole = `CASE 
        WHEN ${hasIsSuperuser ? "is_superuser::text = '1'" : 'false'} THEN 'admin'
        WHEN ${hasIsStaff ? "is_staff::text = '1'" : 'false'} THEN 'admin'
        ELSE 'customer'
      END`;
    }

    let selectAddress = "''";
    if (hasAddress) {
      selectAddress = "COALESCE(address, '')";
    }

    let selectCreatedAt = 'CURRENT_TIMESTAMP';
    if (hasDateJoined) {
      selectCreatedAt = `CASE 
        WHEN date_joined IS NULL OR date_joined = '' THEN CURRENT_TIMESTAMP
        ELSE date_joined::timestamp
      END`;
    }

    let selectLastLogin = 'NULL';
    if (hasLastLogin) {
      selectLastLogin = `CASE 
        WHEN last_login IS NULL OR last_login = '' THEN NULL
        ELSE last_login::timestamp
      END`;
    }

    // Step 7: Copy existing data
    console.log('📥 Migrating existing data from auth_user to users...\n');

    const selectSQL = `
      SELECT 
        ${selectEmail} as email,
        ${selectName} as name,
        ${selectPhone} as phone,
        ${selectPassword} as password,
        ${selectRole} as role,
        ${selectAddress} as address,
        ${selectCreatedAt} as created_at,
        ${selectLastLogin} as last_login
      FROM auth_user
      WHERE ${selectEmail} != '' AND ${selectEmail} IS NOT NULL;
    `;

    const existingData = await pool.query(selectSQL);

    console.log(`📊 Found ${existingData.rows.length} records in auth_user to migrate\n`);

    if (existingData.rows.length === 0) {
      console.log('ℹ️  No existing data to migrate.\n');
    } else {
      let inserted = 0;
      let updated = 0;
      let errors = 0;
      let skipped = 0;
      let djangoPasswords = 0;
      let bcryptPasswords = 0;
      let plainTextPasswords = 0;

      for (const row of existingData.rows) {
        try {
          // Skip if email is empty
          if (!row.email || row.email.trim() === '') {
            skipped++;
            continue;
          }

          // Check if user already exists
          const existingCheck = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [row.email]
          );

          // Process password based on its format
          let passwordHash = row.password || '';
          if (passwordHash) {
            console.log(`   Processing password for ${row.email}...`);
            if (isDjangoPBKDF2(passwordHash)) {
              djangoPasswords++;
            } else if (isBcryptHashed(passwordHash)) {
              bcryptPasswords++;
            } else {
              plainTextPasswords++;
            }
            passwordHash = await processPassword(passwordHash);
          }

          // Ensure name is not empty
          const name = (row.name && row.name.trim() !== '') ? row.name.trim() : 'User';

          const result = await pool.query(`
            INSERT INTO users (
              name,
              email,
              phone,
              password_hash,
              role,
              address,
              created_at,
              last_login,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            ON CONFLICT (email) 
            DO UPDATE SET
              name = EXCLUDED.name,
              phone = EXCLUDED.phone,
              password_hash = EXCLUDED.password_hash,
              role = EXCLUDED.role,
              address = EXCLUDED.address,
              last_login = EXCLUDED.last_login,
              updated_at = CURRENT_TIMESTAMP
            RETURNING id;
          `, [
            name,
            row.email,
            row.phone || '',
            passwordHash,
            row.role || 'customer',
            row.address || '',
            row.created_at,
            row.last_login
          ]);

          if (existingCheck.rows.length > 0) {
            updated++;
          } else {
            inserted++;
          }
        } catch (error) {
          console.error(`❌ Error migrating user ${row.email}:`, error.message);
          errors++;
        }
      }

      console.log(`\n✅ Migration completed:`);
      console.log(`   - Inserted: ${inserted} records`);
      console.log(`   - Updated: ${updated} records`);
      console.log(`   - Skipped: ${skipped} records (empty email)`);
      console.log(`   - Errors: ${errors} records`);
      console.log(`   - Total processed: ${existingData.rows.length} records\n`);
      console.log(`📊 Password formats detected:`);
      console.log(`   - Django PBKDF2: ${djangoPasswords} passwords (kept as-is)`);
      console.log(`   - Bcrypt: ${bcryptPasswords} passwords (kept as-is)`);
      console.log(`   - Plain text: ${plainTextPasswords} passwords (hashed with bcrypt)\n`);
    }

    // Step 8: Verify migration
    const usersCount = await pool.query('SELECT COUNT(*) as count FROM users');
    const authUserCount = await pool.query('SELECT COUNT(*) as count FROM auth_user');
    
    console.log('📊 Verification:');
    console.log(`   - auth_user records: ${authUserCount.rows[0].count}`);
    console.log(`   - users records: ${usersCount.rows[0].count}\n`);

    console.log('✅ Migration completed successfully!');
    console.log('🔄 Future inserts/updates to auth_user will automatically sync to users table.');
    console.log('🔐 Users can now login with the same password they used in the web application.');
    console.log('📝 Note: Login route has been updated to verify both Django PBKDF2 and bcrypt passwords.\n');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    if (error.message.includes('password must be a string')) {
      console.error('\n💡 This error usually means:');
      console.error('   1. DATABASE_URL is missing in backend/.env file');
      console.error('   2. Password is missing in DATABASE_URL');
      console.error('   3. DATABASE_URL format is incorrect\n');
      console.error('   Expected format:');
      console.error('   DATABASE_URL=postgresql://username:password@localhost:5432/db_solar\n');
    }
    console.error('\nFull error:', error);
    await pool.end();
    process.exit(1);
  }
}

migrateAuthUserToUsers();
