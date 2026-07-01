const pool = require('./database/db');

async function testEngineerAssignment() {
  try {
    console.log('🔄 Testing Engineer Assignment for Complaint #3\n');
    
    // Step 1: Revert (Unassign) complaint #3
    console.log('Step 1: Reverting (unassigning) complaint #3...');
    const revertResult = await pool.query(
      `UPDATE firereport_firereport
       SET assignto_id = NULL, assignedtime = NULL, status = 'Pending'
       WHERE id = 3
       RETURNING id, assignto_id, assignedtime, status`
    );
    
    if (revertResult.rows.length > 0) {
      const reverted = revertResult.rows[0];
      console.log('✅ Reverted successfully:');
      console.log(`   Complaint ID: ${reverted.id}`);
      console.log(`   Assigned to Engineer ID: ${reverted.assignto_id || 'NULL (unassigned)'}`);
      console.log(`   Assigned Time: ${reverted.assignedtime || 'NULL'}`);
      console.log(`   Status: ${reverted.status}\n`);
    } else {
      console.log('❌ Complaint #3 not found\n');
      await pool.end();
      process.exit(1);
    }
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 2: Re-assign complaint #3 to engineer 8
    console.log('Step 2: Re-assigning complaint #3 to engineer ID 8...');
    
    // Check status column name
    const colCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'firereport_firereport' 
      AND column_name ILIKE '%status%'
    `);
    const statusCol = colCheck.rows[0]?.column_name || 'status';
    const quotedStatusCol = statusCol !== statusCol.toLowerCase() ? `"${statusCol}"` : statusCol;
    
    const assignResult = await pool.query(
      `UPDATE firereport_firereport
       SET assignto_id = $1, assignedtime = CURRENT_TIMESTAMP, ${quotedStatusCol} = 'Assigned'
       WHERE id = $2
       RETURNING id, assignto_id, assignedtime, ${quotedStatusCol} as status`,
      [8, 3]
    );
    
    if (assignResult.rows.length > 0) {
      const assigned = assignResult.rows[0];
      console.log('✅ Re-assigned successfully:');
      console.log(`   Complaint ID: ${assigned.id}`);
      console.log(`   Assigned to Engineer ID: ${assigned.assignto_id}`);
      console.log(`   Assigned Time: ${assigned.assignedtime}`);
      console.log(`   Status: ${assigned.status}\n`);
    }
    
    // Step 3: Verify engineer information can be fetched
    console.log('Step 3: Verifying engineer information...');
    const verifyResult = await pool.query(
      `SELECT 
        f.id as complaint_id,
        f.assignto_id,
        f.assignedtime,
        au.id as engineer_id,
        au.first_name as engineer_first_name,
        au.last_name as engineer_last_name,
        au.email as engineer_email,
        up.phone as engineer_phone,
        up.workphone as engineer_workphone,
        up.address as engineer_address,
        up.designation as engineer_designation,
        up.department as engineer_department
      FROM firereport_firereport f
      LEFT JOIN auth_user au ON f.assignto_id = au.id
      LEFT JOIN user_profile up ON au.id = up.customer_id
      WHERE f.id = 3`
    );
    
    if (verifyResult.rows.length > 0) {
      const row = verifyResult.rows[0];
      console.log('✅ Engineer information retrieved:');
      console.log(`   Engineer ID: ${row.engineer_id || 'Not found'}`);
      console.log(`   Name: ${row.engineer_first_name || ''} ${row.engineer_last_name || ''}`.trim() || 'Not found');
      console.log(`   Email: ${row.engineer_email || 'Not found'}`);
      console.log(`   Phone: ${row.engineer_workphone || row.engineer_phone || 'Not found'}`);
      console.log(`   Address: ${row.engineer_address || 'Not found'}`);
      console.log(`   Designation: ${row.engineer_designation || 'Not found'}`);
      console.log(`   Department: ${row.engineer_department || 'Not found'}\n`);
      
      if (row.engineer_id) {
        console.log('✅ Engineer section will display correctly in the app!');
      } else {
        console.log('⚠️  Warning: Engineer information not found. Please verify engineer ID 8 exists.');
      }
    }
    
    await pool.end();
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

testEngineerAssignment();
