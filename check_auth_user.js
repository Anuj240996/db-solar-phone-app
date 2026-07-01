require('dotenv').config();
const pool = require('./database/db');

async function checkAuthUser() {
  try {
    console.log('🔍 Checking auth_user table...\n');

    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'auth_user'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ auth_user table does not exist');
      process.exit(1);
    }

    console.log('✅ auth_user table exists\n');

    // Get columns
    const columns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'auth_user' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    console.log('📋 Columns:');
    columns.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });
    console.log('');

    // Get sample data (first 3 rows, hide password)
    const sampleData = await pool.query(`
      SELECT * FROM auth_user LIMIT 3;
    `);

    console.log(`📊 Sample data (${sampleData.rows.length} rows):`);
    sampleData.rows.forEach((row, index) => {
      console.log(`\n   Row ${index + 1}:`);
      Object.keys(row).forEach(key => {
        if (key.toLowerCase().includes('password')) {
          console.log(`     ${key}: ${row[key] ? row[key].substring(0, 20) + '...' : 'NULL'}`);
        } else {
          console.log(`     ${key}: ${row[key]}`);
        }
      });
    });

    // Count total rows
    const count = await pool.query('SELECT COUNT(*) as count FROM auth_user');
    console.log(`\n📈 Total rows in auth_user: ${count.rows[0].count}`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkAuthUser();

