// Test script to check firereport_firereport table structure
const pool = require('./database/db');

async function testTableStructure() {
  try {
    // Get all columns
    const columnsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'firereport_firereport'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Table Structure:');
    console.log(JSON.stringify(columnsResult.rows, null, 2));
    
    // Test a simple insert
    const testData = {
      id: 999999, // Use a high number to avoid conflicts
      fullName: 'Test User',
      mobileNumber: '1234567890',
      location: 'Test City',
      message: 'Test message',
      status: 'Pending',
      postingDate: new Date().toISOString(),
      accountId: 65,
      category: 'Test Category',
      title: 'Test Title',
    };
    
    // Try minimal insert first
    try {
      const result = await pool.query(`
        INSERT INTO firereport_firereport 
        (id, "FullName", "MobileNumber", "Location", "Message", "Status", "Postingdate", "Account_id", "AssignBy")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
        testData.id,
        testData.fullName,
        testData.mobileNumber,
        testData.location,
        testData.message,
        testData.status,
        testData.postingDate,
        testData.accountId,
        testData.accountId,
      ]);
      console.log('✅ Minimal insert successful:', result.rows[0]);
      
      // Clean up
      await pool.query('DELETE FROM firereport_firereport WHERE id = $1', [testData.id]);
    } catch (err) {
      console.error('❌ Minimal insert failed:', err.message);
      console.error('Error code:', err.code);
      console.error('Error detail:', err.detail);
    }
    
    // Try with category and title if they exist
    const hasCategory = columnsResult.rows.some(r => r.column_name === 'category');
    const hasTitle = columnsResult.rows.some(r => r.column_name === 'title');
    
    if (hasCategory && hasTitle) {
      try {
        const result = await pool.query(`
          INSERT INTO firereport_firereport 
          (id, "FullName", "MobileNumber", "Location", "Message", "Status", "Postingdate", 
           "Account_id", category, title, "AssignBy")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id
        `, [
          testData.id,
          testData.fullName,
          testData.mobileNumber,
          testData.location,
          testData.message,
          testData.status,
          testData.postingDate,
          testData.accountId,
          testData.category,
          testData.title,
          testData.accountId,
        ]);
        console.log('✅ Insert with category/title successful:', result.rows[0]);
        
        // Clean up
        await pool.query('DELETE FROM firereport_firereport WHERE id = $1', [testData.id]);
      } catch (err) {
        console.error('❌ Insert with category/title failed:', err.message);
        console.error('Error code:', err.code);
        console.error('Error detail:', err.detail);
        console.error('Error hint:', err.hint);
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await pool.end();
  }
}

testTableStructure();
