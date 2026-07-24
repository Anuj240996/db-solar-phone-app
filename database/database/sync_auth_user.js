const pool = require('./db');
require('dotenv').config();

/**
 * Sync data from auth_user table to users table
 * This script:
 * 1. Creates a trigger function to automatically sync new auth_user entries
 * 2. Copies all existing data from auth_user to users
 * 3. Ensures users can login with credentials from users table
 */

async function syncAuthUserToUsers() {
  try {
    console.log('🚀 Starting auth_user to users sync...\n');

    // Step 1: Check if auth_user table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'auth_user'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ auth_user table does not exist. Skipping sync.');
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

    // Step 3: Find field mappings
    const findField = (preferred, alternatives = []) => {
      const allOptions = [preferred, ...alternatives];
      return allOptions.find(col => authUserCols.includes(col)) || null;
    };

    const nameField = findField('name', ['username']);
    const firstNameField = findField('first_name');
    const lastNameField = findField('last_name');
    const phoneField = findField('phone', ['phone_number', 'mobile']);
    const passwordField = findField('password_hash', ['password']);
    const roleField = findField('role');
    const addressField = findField('address');
    const createdAtField = findField('created_at', ['date_joined', 'joined_at']);
    const lastLoginField = findField('last_login', ['last_login_at']);

    console.log('🔍 Field mappings:');
    console.log(`   name: ${nameField || (firstNameField && lastNameField ? `${firstNameField} + ${lastNameField}` : 'User (default)')}`);
    console.log(`   phone: ${phoneField || 'empty'}`);
    console.log(`   password: ${passwordField || 'empty'}`);
    console.log(`   role: ${roleField || 'customer (default)'}`);
    console.log(`   address: ${addressField || 'empty'}`);
    console.log(`   created_at: ${createdAtField || 'CURRENT_TIMESTAMP'}`);
    console.log(`   last_login: ${lastLoginField || 'NULL'}`);
    console.log('');

    // Step 4: Build trigger function SQL
    // Build name expression for trigger
    let nameExpr = "'User'";
    if (nameField) {
      nameExpr = `COALESCE(NEW.${nameField}, 'User')`;
    } else if (firstNameField && lastNameField) {
      nameExpr = `COALESCE(NEW.${firstNameField} || ' ' || NEW.${lastNameField}, 'User')`;
    }

    const phoneExpr = phoneField ? `COALESCE(NEW.${phoneField}, '')` : "''";
    const passwordExpr = passwordField ? `COALESCE(NEW.${passwordField}, '')` : "''";
    const roleExpr = roleField ? `COALESCE(NEW.${roleField}, 'customer')` : "'customer'";
    const addressExpr = addressField ? `COALESCE(NEW.${addressField}, '')` : "''";
    const createdAtExpr = createdAtField ? `COALESCE(NEW.${createdAtField}, CURRENT_TIMESTAMP)` : 'CURRENT_TIMESTAMP';
    const lastLoginExpr = lastLoginField ? `NEW.${lastLoginField}` : 'NULL';

    // Step 5: Create trigger function
    console.log('🔧 Creating trigger function...');

    const triggerFunctionSQL = `
      CREATE OR REPLACE FUNCTION sync_auth_user_to_users()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO users (
          id,
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
          COALESCE(NEW.id, gen_random_uuid()),
          ${nameExpr},
          NEW.email,
          ${phoneExpr},
          ${passwordExpr},
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

    // Step 6: Create trigger
    await pool.query(`
      DROP TRIGGER IF EXISTS trigger_sync_auth_user_to_users ON auth_user;
    `);

    await pool.query(`
      CREATE TRIGGER trigger_sync_auth_user_to_users
      AFTER INSERT OR UPDATE ON auth_user
      FOR EACH ROW
      EXECUTE FUNCTION sync_auth_user_to_users();
    `);

    console.log('✅ Trigger created\n');

    // Step 7: Build SELECT query for existing data
    let selectName = "'User'";
    if (nameField) {
      selectName = nameField;
    } else if (firstNameField && lastNameField) {
      selectName = `${firstNameField} || ' ' || ${lastNameField}`;
    }

    const selectPhone = phoneField || "''";
    const selectPassword = passwordField || "''";
    const selectRole = roleField || "'customer'";
    const selectAddress = addressField || "''";
    const selectCreatedAt = createdAtField || 'CURRENT_TIMESTAMP';
    const selectLastLogin = lastLoginField || 'NULL';

    // Step 8: Copy existing data
    console.log('📥 Copying existing data from auth_user to users...\n');

    const selectSQL = `
      SELECT 
        id,
        COALESCE(${selectName}, 'User') as name,
        email,
        COALESCE(${selectPhone}, '') as phone,
        COALESCE(${selectPassword}, '') as password_hash,
        COALESCE(${selectRole}, 'customer') as role,
        COALESCE(${selectAddress}, '') as address,
        COALESCE(${selectCreatedAt}, CURRENT_TIMESTAMP) as created_at,
        ${selectLastLogin} as last_login
      FROM auth_user;
    `;

    const existingData = await pool.query(selectSQL);

    console.log(`📊 Found ${existingData.rows.length} records in auth_user\n`);

    if (existingData.rows.length === 0) {
      console.log('ℹ️  No existing data to sync.\n');
    } else {
      let inserted = 0;
      let updated = 0;
      let errors = 0;

      for (const row of existingData.rows) {
        try {
          // Check if user already exists
          const existingCheck = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [row.email]
          );

          const result = await pool.query(`
            INSERT INTO users (
              id,
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
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
            row.id,
            row.name,
            row.email,
            row.phone || '',
            row.password_hash || '',
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
          console.error(`❌ Error syncing user ${row.email}:`, error.message);
          errors++;
        }
      }

      console.log(`✅ Sync completed:`);
      console.log(`   - Inserted: ${inserted} records`);
      console.log(`   - Updated: ${updated} records`);
      console.log(`   - Errors: ${errors} records`);
      console.log(`   - Total processed: ${existingData.rows.length} records\n`);
    }

    // Step 9: Verify sync
    const usersCount = await pool.query('SELECT COUNT(*) as count FROM users');
    const authUserCount = await pool.query('SELECT COUNT(*) as count FROM auth_user');
    
    console.log('📊 Verification:');
    console.log(`   - auth_user records: ${authUserCount.rows[0].count}`);
    console.log(`   - users records: ${usersCount.rows[0].count}\n`);

    console.log('✅ Sync completed successfully!');
    console.log('🔄 Future inserts/updates to auth_user will automatically sync to users table.');
    console.log('🔐 Users can now login with credentials from the users table.\n');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Sync error:', error);
    await pool.end();
    process.exit(1);
  }
}

syncAuthUserToUsers();
