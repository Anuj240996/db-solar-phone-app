/**
 * Migration script to create growatt_credentials table
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runMigration() {
  let pool;
  
  try {
    console.log('🟡 Starting growatt_credentials table migration...');
    
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

    // Read and execute SQL
    const sql = fs.readFileSync(
      path.join(__dirname, 'add_growatt_credentials_column.sql'),
      'utf8'
    );

    await pool.query(sql);
    console.log('✅ growatt_credentials table created/verified');

    // Verify table exists
    const verify = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'growatt_credentials'
      ORDER BY ordinal_position;
    `);

    if (verify.rows.length > 0) {
      console.log('\n📊 Table structure:');
      verify.rows.forEach(col => {
        console.log(`   - ${col.column_name}: ${col.data_type}`);
      });
    }

    console.log('\n✅ Migration completed successfully!');
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    if (pool) {
      await pool.end();
    }
    process.exit(1);
  }
}

runMigration();
