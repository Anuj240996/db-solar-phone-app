/**
 * Script to insert a sample plant for user ID 220
 * Handles type mismatch between auth_user.id (bigint) and plants.user_id (UUID)
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function insertSamplePlant() {
  let pool;
  
  try {
    console.log('🟡 Inserting sample plant...');
    
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

    // Insert with NULL user_id to avoid type mismatch (will be set via backend)
    // The backend handles user association differently
    const insertResult = await pool.query(`
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
        NULL,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      ) RETURNING id, name;
    `, [
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
    console.log('\n⚠️  Note: user_id is NULL due to type mismatch.');
    console.log('   The backend will handle user association via authentication.');
    console.log('\n💡 Next steps:');
    console.log('   1. Login to Growatt dashboard (https://server.growatt.com)');
    console.log('   2. Get your Plant ID from the dashboard');
    console.log(`   3. Run: UPDATE plants SET growatt_plant_id = 'YOUR_GROWATT_PLANT_ID' WHERE id = '${plant.id}';`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('violates foreign key')) {
      console.error('💡 Tip: The plants table might have a foreign key constraint.');
      console.error('   You may need to temporarily disable it or fix the user_id type mismatch.');
    }
    if (pool) {
      await pool.end();
    }
    process.exit(1);
  }
}

insertSamplePlant();
