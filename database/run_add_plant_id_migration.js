const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔵 Starting migration: Add plant_ids to growatt_credentials...');
    
    // Read SQL file
    const sqlPath = path.join(__dirname, 'add_plant_id_to_growatt_credentials.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute migration
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    
    console.log('✅ Migration completed successfully!');
    console.log('✅ Added plant_ids column to growatt_credentials table');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL environment variable is not set');
  console.error('Please set DATABASE_URL in your .env file');
  process.exit(1);
}

runMigration().catch(console.error);
