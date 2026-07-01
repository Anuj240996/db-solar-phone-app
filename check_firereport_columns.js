// Script to check actual columns in firereport_firereport table
const pool = require('./database/db');

async function checkColumns() {
  try {
    console.log('🔍 Checking firereport_firereport table structure...\n');
    
    // Get all columns
    const result = await pool.query(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default,
        ordinal_position
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'firereport_firereport'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Total columns:', result.rows.length);
    console.log('\n📊 Column Details:');
    console.log('─'.repeat(80));
    
    result.rows.forEach((row, index) => {
      const type = row.character_maximum_length 
        ? `${row.data_type}(${row.character_maximum_length})`
        : row.data_type;
      const nullable = row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      
      console.log(`${(index + 1).toString().padStart(2)}. ${row.column_name.padEnd(20)} | ${type.padEnd(25)} | ${nullable}`);
    });
    
    console.log('─'.repeat(80));
    
    // Check which columns are used in backend
    const usedColumns = [
      'id', 'FullName', 'fullname', 'MobileNumber', 'mobilenumber',
      'Location', 'location', 'Message', 'message', 'Status', 'status',
      'Postingdate', 'postingdate', 'Account_id', 'account_id',
      'AssignBy', 'assignby', 'category', 'title'
    ];
    
    const columnNames = result.rows.map(r => r.column_name);
    const lowerColumnNames = columnNames.map(c => c.toLowerCase());
    
    console.log('\n✅ Columns Used in Backend:');
    console.log('─'.repeat(80));
    
    usedColumns.forEach(col => {
      const found = columnNames.find(c => c.toLowerCase() === col.toLowerCase());
      if (found) {
        console.log(`✓ ${found.padEnd(20)} (matches: ${col})`);
      }
    });
    
    // Check for category and title
    const hasCategory = columnNames.some(c => c.toLowerCase() === 'category');
    const hasTitle = columnNames.some(c => c.toLowerCase() === 'title');
    
    console.log('\n📌 Category/Title Status:');
    console.log(`   Category column: ${hasCategory ? '✅ EXISTS' : '❌ MISSING'}`);
    console.log(`   Title column: ${hasTitle ? '✅ EXISTS' : '❌ MISSING'}`);
    
    if (!hasCategory || !hasTitle) {
      console.log('\n⚠️  Recommendation: Run migration to add missing columns:');
      console.log('   ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS category VARCHAR(255);');
      console.log('   ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS title VARCHAR(255);');
    }
    
    // Show exact column names (case-sensitive)
    console.log('\n🔤 Exact Column Names (Case-Sensitive):');
    columnNames.forEach((name, idx) => {
      const needsQuotes = name !== name.toLowerCase();
      console.log(`   ${(idx + 1).toString().padStart(2)}. ${needsQuotes ? `"${name}"` : name}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

checkColumns();
