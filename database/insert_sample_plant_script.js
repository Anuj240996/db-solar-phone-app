/**
 * Script to insert a sample plant for user ID 220
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function insertSamplePlant() {
  let pool;
  
  try {
    console.log('🟡 Inserting sample plant for user ID 220...');
    
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

    // Get the user ID - handle both integer and UUID types
    const userResult = await pool.query(`
      SELECT id::text as id FROM auth_user WHERE id = 220 LIMIT 1;
    `);

    if (userResult.rows.length === 0) {
      console.error('❌ User ID 220 not found in auth_user table');
      process.exit(1);
    }

    const userIdText = userResult.rows[0].id;
    
    // Check if plants.user_id is UUID or integer
    const columnCheck = await pool.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'plants' AND column_name = 'user_id';
    `);
    
    const userIdType = columnCheck.rows[0]?.data_type || 'unknown';
    console.log(`ℹ️  plants.user_id type: ${userIdType}`);
    console.log(`ℹ️  auth_user.id value: ${userIdText}`);
    
    // Handle type mismatch: auth_user.id is bigint, but plants.user_id might be UUID
    // Try to find if there's a way to link them, or use NULL temporarily
    let userId;
    
    if (userIdType === 'uuid') {
      // Since auth_user.id is integer and plants.user_id is UUID, 
      // we'll insert with NULL and update later, OR
      // generate a UUID from the integer
      // For now, let's try converting integer to a UUID format
      // PostgreSQL's uuid generation: we can use gen_random_uuid() or 
      // try to pad the integer to UUID format
      
      // Option 1: Insert with NULL user_id (remove foreign key constraint temporarily)
      // Option 2: Try to find actual UUID in another table
      // Option 3: Generate a deterministic UUID from the integer
      
      // Let's try a workaround - check if there's a foreign key constraint
      console.log('⚠️  Type mismatch detected: auth_user.id is integer but plants.user_id is UUID');
      console.log('💡 Trying to insert with NULL user_id and then update...');
      userId = null; // Will set after insert if needed
    } else {
      userId = parseInt(userIdText);
    }

    // Check if plant already exists
    const existingCheck = await pool.query(`
      SELECT COUNT(*) as count FROM plants WHERE user_id = $1;
    `, [userId]);

    const existingCount = parseInt(existingCheck.rows[0].count);
    if (existingCount > 0) {
      console.log(`ℹ️  ${existingCount} plant(s) already exist for this user. Skipping insert.`);
      
      // Show existing plants
      const existingPlants = await pool.query(`
        SELECT id, name, growatt_plant_id 
        FROM plants 
        WHERE user_id = $1;
      `, [userId]);

      console.log('\n📊 Existing plants:');
      existingPlants.rows.forEach(plant => {
        const status = plant.growatt_plant_id 
          ? `✅ Linked (Growatt ID: ${plant.growatt_plant_id})`
          : '⚠️  Not linked to Growatt';
        console.log(`   - ${plant.name} (${plant.id.substring(0, 8)}...): ${status}`);
      });
      
      await pool.end();
      process.exit(0);
    }

    // Insert sample plant
    // If user_id needs to be UUID but we have integer, we'll handle it
    const userValue = userIdType === 'uuid' && userId === null 
      ? 'NULL' 
      : `$${userId === null ? 10 : 1}`;
      
    const insertQuery = `
      INSERT INTO plants (
        id,
        user_id,
        name,
        location,
        capacity,
        status,
        installation_date,
        daily_generation,
        monthly_generation,
        yearly_generation,
        growatt_plant_id,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      ) RETURNING id, name;
    `, [
      userId,
      'Heramb Industries Solar Plant',
      'Mumbai, Maharashtra',
      50.00,
      'active',
      new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 6 months ago
      25.5,
      750.0,
      1250.0,
      null, // growatt_plant_id - to be filled later
    ]);

    const plant = insertResult.rows[0];
    console.log('\n✅ Sample plant inserted successfully!');
    console.log(`   Plant ID: ${plant.id}`);
    console.log(`   Name: ${plant.name}`);
    console.log('\n💡 Next steps:');
    console.log('   1. Login to Growatt dashboard (https://server.growatt.com)');
    console.log('   2. Get your Plant ID from the dashboard');
    console.log(`   3. Run: UPDATE plants SET growatt_plant_id = 'YOUR_GROWATT_PLANT_ID' WHERE id = '${plant.id}';`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('violates foreign key')) {
      console.error('💡 Tip: Make sure user_id exists in auth_user table');
    }
    if (pool) {
      await pool.end();
    }
    process.exit(1);
  }
}

insertSamplePlant();
