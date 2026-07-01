const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runMigration() {
  let pool;
  
  try {
    console.log('Running migration to add progress_date, working_date, and complete_date columns...');
    
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      console.error('❌ Error: DATABASE_URL environment variable is not set.');
      console.error('Please set DATABASE_URL in your .env file or environment variables.');
      console.error('\nExample format:');
      console.error('DATABASE_URL=postgresql://username:password@localhost:5432/database_name');
      process.exit(1);
    }
    
    // Create a new pool with explicit configuration
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    
    // Test connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection established');
    
    // Execute individual ALTER TABLE statements (more reliable than reading SQL file)
    console.log('Adding progress_date column...');
    await pool.query(`
      ALTER TABLE firereport_firereport 
      ADD COLUMN IF NOT EXISTS progress_date TIMESTAMP
    `);
    
    console.log('Adding working_date column...');
    await pool.query(`
      ALTER TABLE firereport_firereport 
      ADD COLUMN IF NOT EXISTS working_date TIMESTAMP
    `);
    
    console.log('Adding complete_date column...');
    await pool.query(`
      ALTER TABLE firereport_firereport 
      ADD COLUMN IF NOT EXISTS complete_date TIMESTAMP
    `);
    
    console.log('✅ Migration completed successfully!');
    console.log('Added columns: progress_date, working_date, complete_date');
    
    // Verify the columns were added
    const verifyQuery = `
      SELECT 
        column_name, 
        data_type,
        is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'firereport_firereport' 
      AND column_name IN ('progress_date', 'working_date', 'complete_date')
      ORDER BY column_name;
    `;
    
    const result = await pool.query(verifyQuery);
    
    if (result.rows.length > 0) {
      console.log('\n✅ Verification - Columns found:');
      result.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
    } else {
      console.log('\n⚠️  Warning: Columns not found after migration');
    }
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    if (error.message.includes('password')) {
      console.error('\n💡 Tip: Check your DATABASE_URL in .env file.');
      console.error('The connection string should be in format:');
      console.error('postgresql://username:password@host:port/database');
    }
    if (pool) {
      await pool.end();
    }
    process.exit(1);
  }
}

runMigration();
