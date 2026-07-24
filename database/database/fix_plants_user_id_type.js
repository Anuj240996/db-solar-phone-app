/**
 * Fix plants.user_id type from UUID to bigint to match auth_user.id
 * Then update the sample plant with user_id = 220
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function fixUserIdType() {
  let pool;
  
  try {
    console.log('🟡 Fixing plants.user_id type mismatch...');
    
    if (!process.env.DATABASE_URL) {
      console.error('❌ Error: DATABASE_URL environment variable is not set');
      process.exit(1);
    }

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    await pool.query('SELECT 1');
    console.log('✅ Connected to database');

    // Check current type
    const currentType = await pool.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'plants' AND column_name = 'user_id';
    `);
    
    const userIdType = currentType.rows[0]?.data_type;
    console.log(`ℹ️  Current plants.user_id type: ${userIdType}`);

    if (userIdType === 'bigint') {
      console.log('✅ plants.user_id is already bigint, no change needed');
    } else if (userIdType === 'uuid') {
      console.log('📋 Converting plants.user_id from UUID to bigint...');
      
      // Step 1: Drop foreign key constraint if it exists
      try {
        await pool.query(`
          ALTER TABLE plants DROP CONSTRAINT IF EXISTS plants_user_id_fkey;
        `);
        console.log('✅ Dropped foreign key constraint (if existed)');
      } catch (err) {
        console.log('ℹ️  No foreign key constraint to drop or already dropped');
      }

      // Step 2: Convert column type
      // First, set all UUID values to NULL since we can't directly convert
      await pool.query(`
        ALTER TABLE plants ALTER COLUMN user_id DROP NOT NULL;
      `);
      
      await pool.query(`
        ALTER TABLE plants ALTER COLUMN user_id TYPE bigint USING NULL;
      `);
      
      console.log('✅ Converted plants.user_id to bigint');

      // Step 3: Re-add foreign key constraint to auth_user if needed
      // (We won't add it back since auth_user might have a different relationship)
    } else {
      console.log(`⚠️  Unexpected type: ${userIdType}`);
    }

    // Update the sample plant with user_id = 220
    console.log('\n📋 Updating sample plant with user_id = 220...');
    
    const updateResult = await pool.query(`
      UPDATE plants 
      SET user_id = 220 
      WHERE user_id IS NULL 
      AND name = 'Heramb Industries Solar Plant'
      RETURNING id, name, user_id;
    `);

    if (updateResult.rows.length > 0) {
      const plant = updateResult.rows[0];
      console.log('✅ Updated plant:');
      console.log(`   Plant ID: ${plant.id}`);
      console.log(`   Name: ${plant.name}`);
      console.log(`   User ID: ${plant.user_id}`);
    } else {
      console.log('⚠️  No plant found to update, or already has user_id');
    }

    // Verify the update
    const verifyResult = await pool.query(`
      SELECT id, name, user_id, growatt_plant_id 
      FROM plants 
      WHERE user_id = 220;
    `);

    if (verifyResult.rows.length > 0) {
      console.log('\n📊 Plants for user ID 220:');
      verifyResult.rows.forEach(plant => {
        const growattStatus = plant.growatt_plant_id 
          ? `✅ Linked (Growatt ID: ${plant.growatt_plant_id})`
          : '⚠️  Not linked to Growatt';
        console.log(`   - ${plant.name} (${plant.id.substring(0, 8)}...): ${growattStatus}`);
      });
    }

    console.log('\n✅ Schema fix completed successfully!');
    console.log('\n💡 Next step: Link to Growatt API');
    console.log('   1. Login to Growatt dashboard (https://server.growatt.com)');
    console.log('   2. Get your Plant ID from the dashboard');
    console.log('   3. Run: UPDATE plants SET growatt_plant_id = \'YOUR_GROWATT_PLANT_ID\' WHERE user_id = 220;');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    if (pool) {
      await pool.end();
    }
    process.exit(1);
  }
}

fixUserIdType();
