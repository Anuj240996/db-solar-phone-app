// Test script to verify the INSERT query works correctly
const pool = require('./database/db');

async function testInsert() {
  try {
    console.log('🧪 Testing INSERT query for firereport_firereport...\n');
    
    // Check if category and title columns exist
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'firereport_firereport' 
      AND column_name IN ('category', 'title')
    `);
    
    const hasCategory = columnCheck.rows.some(row => row.column_name === 'category');
    const hasTitle = columnCheck.rows.some(row => row.column_name === 'title');
    
    console.log('📋 Column check:');
    console.log('  - category column exists:', hasCategory);
    console.log('  - title column exists:', hasTitle);
    console.log('');
    
    // Get all column names
    const allColumnsResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'firereport_firereport'
      ORDER BY ordinal_position
    `);
    const allColumns = allColumnsResult.rows.map(r => r.column_name);
    
    console.log('📋 All columns in firereport_firereport:');
    allColumns.forEach((col, idx) => {
      console.log(`  ${idx + 1}. ${col}`);
    });
    console.log('');
    
    // Create column map
    const columnMap = {};
    allColumns.forEach(col => {
      columnMap[col.toLowerCase()] = col;
    });
    
    const getColumnName = (name) => {
      const lowerName = name.toLowerCase();
      if (columnMap[lowerName]) {
        const actualName = columnMap[lowerName];
        if (actualName !== actualName.toLowerCase()) {
          return `"${actualName}"`;
        }
        return actualName;
      }
      return name;
    };
    
    // Build column names
    const idCol = getColumnName('id') || 'id';
    const fullNameCol = getColumnName('fullname') || 'fullname';
    const mobileCol = getColumnName('mobilenumber') || 'mobilenumber';
    const locationCol = getColumnName('Location') || 'Location';
    const messageCol = getColumnName('message') || 'message';
    const statusCol = getColumnName('status') || 'status';
    const postingDateCol = getColumnName('postingdate') || 'postingdate';
    const accountIdCol = getColumnName('account_id') || 'account_id';
    const assignByCol = getColumnName('assignby') || 'assignby';
    
    console.log('🔧 Column names to use:');
    console.log('  id:', idCol);
    console.log('  fullname:', fullNameCol);
    console.log('  mobilenumber:', mobileCol);
    console.log('  location:', locationCol);
    console.log('  message:', messageCol);
    console.log('  status:', statusCol);
    console.log('  postingdate:', postingDateCol);
    console.log('  account_id:', accountIdCol);
    console.log('  assignby:', assignByCol);
    console.log('');
    
    // Build query
    let insertQuery;
    let insertParams;
    
    if (hasCategory && hasTitle) {
      const categoryCol = getColumnName('category') || 'category';
      const titleCol = getColumnName('title') || 'title';
      
      insertQuery = `INSERT INTO firereport_firereport (${idCol}, ${fullNameCol}, ${mobileCol}, ${locationCol}, ${messageCol}, ${statusCol}, ${postingDateCol}, ${accountIdCol}, ${categoryCol}, ${titleCol}, ${assignByCol}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${idCol}`;
      
      insertParams = [
        999999,              // Test ID
        'Test User',         // FullName
        '1234567890',        // MobileNumber
        'Test City',         // Location
        'Test description',  // Message
        'Pending',           // Status
        new Date().toISOString(), // Postingdate
        65,                  // Account_id (test user)
        'Test Category',     // category
        'Test Title',        // title
        65,                  // AssignBy
      ];
      
      console.log('✅ Using query WITH category and title columns');
    } else {
      insertQuery = `INSERT INTO firereport_firereport (${idCol}, ${fullNameCol}, ${mobileCol}, ${locationCol}, ${messageCol}, ${statusCol}, ${postingDateCol}, ${accountIdCol}, ${assignByCol}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${idCol}`;
      
      insertParams = [
        999999,              // Test ID
        'Test User',         // FullName
        '1234567890',        // MobileNumber
        'Test City',         // Location
        '[Category: Test] [Title: Test]\n\nTest description', // Message
        'Pending',           // Status
        new Date().toISOString(), // Postingdate
        65,                  // Account_id
        65,                  // AssignBy
      ];
      
      console.log('⚠️  Using query WITHOUT category and title columns');
    }
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📝 GENERATED QUERY:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(insertQuery);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Parameters:', insertParams.length);
    console.log('📊 Placeholders:', (insertQuery.match(/\$(\d+)/g) || []).length);
    console.log('');
    
    // Check for ? placeholders (should be none)
    if (insertQuery.includes('?')) {
      console.error('❌ ERROR: Query contains ? placeholders!');
      console.error('This should use $1, $2, etc. for PostgreSQL');
      process.exit(1);
    }
    
    // Validate placeholder count
    const placeholderCount = (insertQuery.match(/\$(\d+)/g) || []).length;
    if (placeholderCount !== insertParams.length) {
      console.error('❌ ERROR: Parameter count mismatch!');
      console.error(`Placeholders: ${placeholderCount}, Parameters: ${insertParams.length}`);
      process.exit(1);
    }
    
    console.log('✅ Query validation passed!');
    console.log('✅ All placeholders use $1, $2, etc. format');
    console.log('✅ Parameter count matches placeholder count');
    console.log('');
    console.log('💡 Note: This is just a validation test. No actual insert was performed.');
    console.log('💡 To test actual insert, modify this script to remove the test ID check.');
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testInsert();
