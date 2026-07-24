/**
 * Migration script to create or update plants table for Growatt integration
 * 
 * Usage: node backend/database/run_plants_migration.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runMigration() {
  let client;
  let pool;
  
  try {
    console.log('🟡 Starting plants table migration...');
    
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      console.error('❌ Error: DATABASE_URL environment variable is not set');
      console.log('💡 Please set DATABASE_URL in your .env file');
      console.log('\nExample format:');
      console.log('DATABASE_URL=postgresql://username:password@localhost:5432/database_name');
      process.exit(1);
    }

    // Create pool if not available
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    // Test connection
    await pool.query('SELECT 1');
    client = await pool.connect();
    console.log('✅ Connected to database');

    // Read SQL files
    const createTableSql = fs.readFileSync(
      path.join(__dirname, 'create_plants_table.sql'),
      'utf8'
    );
    
    const addColumnSql = fs.readFileSync(
      path.join(__dirname, 'add_growatt_plant_id_column.sql'),
      'utf8'
    );

    // Check if plants table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'plants'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('📋 Creating plants table...');
      await client.query(createTableSql);
      console.log('✅ Plants table created successfully');
    } else {
      console.log('ℹ️  Plants table already exists, adding growatt_plant_id column...');
      await client.query(addColumnSql);
      console.log('✅ Plants table updated successfully');
    }

    // First, check what type user_id is in plants table
    const columnInfo = await client.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'plants' 
      AND column_name = 'user_id';
    `);
    
    const userIdType = columnInfo.rows[0]?.data_type || 'unknown';
    console.log(`ℹ️  user_id column type: ${userIdType}`);
    
    // Get user ID from auth_user table (your login user ID was 220)
    const userCheck = await client.query(`
      SELECT id FROM auth_user WHERE id = 220 OR username = 'DB_JDeshmukh2019' LIMIT 1;
    `);
    
    let actualUserId = null;
    if (userCheck.rows.length > 0) {
      actualUserId = userCheck.rows[0].id;
      console.log(`✅ Found user ID in auth_user: ${actualUserId}`);
    } else {
      console.log('⚠️  User ID 220 not found in auth_user table');
      console.log('💡 Will check all plants regardless of user_id');
    }

    // Check if user has any plants (handle both integer and UUID types)
    let plantCheck;
    if (actualUserId) {
      if (userIdType === 'uuid') {
        plantCheck = await client.query(`
          SELECT COUNT(*) as count FROM plants WHERE user_id::text = $1::text;
        `, [actualUserId.toString()]);
      } else {
        plantCheck = await client.query(`
          SELECT COUNT(*) as count FROM plants WHERE user_id = $1;
        `, [actualUserId]);
      }
    } else {
      // Just count all plants
      plantCheck = await client.query(`SELECT COUNT(*) as count FROM plants;`);
    }
    
    const plantCount = parseInt(plantCheck.rows[0].count);
    
    if (plantCount === 0) {
      console.log(`📋 No plants found ${actualUserId ? 'for user ID ' + actualUserId : ''}.`);
      console.log('💡 Run this SQL to insert a sample plant:');
      console.log('   psql $DATABASE_URL -f backend/database/insert_sample_plant.sql');
    } else {
      console.log(`✅ Found ${plantCount} plant(s) ${actualUserId ? 'for user ID ' + actualUserId : 'in database'}`);
    }

    // Check growatt_plant_id values
    let growattCheck;
    if (actualUserId) {
      if (userIdType === 'uuid') {
        growattCheck = await client.query(`
          SELECT id, name, growatt_plant_id 
          FROM plants 
          WHERE user_id::text = $1::text;
        `, [actualUserId.toString()]);
      } else {
        growattCheck = await client.query(`
          SELECT id, name, growatt_plant_id 
          FROM plants 
          WHERE user_id = $1;
        `, [actualUserId]);
      }
    } else {
      growattCheck = await client.query(`
        SELECT id, name, growatt_plant_id 
        FROM plants 
        LIMIT 10;
      `);
    }
    
    console.log('\n📊 Current plants status:');
    if (growattCheck.rows.length > 0) {
      growattCheck.rows.forEach(plant => {
        const status = plant.growatt_plant_id 
          ? `✅ Linked (Growatt ID: ${plant.growatt_plant_id})`
          : '⚠️  Not linked to Growatt (growatt_plant_id is NULL)';
        console.log(`   - ${plant.name}: ${status}`);
      });
      
      if (growattCheck.rows.some(p => !p.growatt_plant_id)) {
        console.log('\n💡 To link plants to Growatt API:');
        console.log('   1. Login to Growatt dashboard');
        console.log('   2. Get your Plant ID from the dashboard');
        console.log('   3. Run: UPDATE plants SET growatt_plant_id = \'YOUR_GROWATT_PLANT_ID\' WHERE id = \'YOUR_PLANT_ID\';');
      }
    }

    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    // Note: pool might not be defined in this scope, so we'll handle it in the try block
    if (typeof pool !== 'undefined' && pool) {
      await pool.end();
    }
  }
}

// Run migration
runMigration();
