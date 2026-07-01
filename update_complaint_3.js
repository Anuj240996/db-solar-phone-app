const pool = require('./database/db');

async function updateComplaint() {
  try {
    console.log('Updating complaint ID 3...');
    
    // Update the complaint
    const result = await pool.query(
      `UPDATE firereport_firereport
       SET 
         assignto_id = $1,
         assignedtime = CURRENT_TIMESTAMP,
         "Status" = 'Assigned'
       WHERE id = $2
       RETURNING id, assignto_id, assignedtime, "Status"`,
      [8, 3]
    );

    if (result.rows.length > 0) {
      const updated = result.rows[0];
      console.log('\n✅ Complaint updated successfully!');
      console.log(`   Complaint ID: ${updated.id}`);
      console.log(`   Assigned to Engineer ID: ${updated.assignto_id}`);
      console.log(`   Assigned Time: ${updated.assignedtime}`);
      console.log(`   Status: ${updated.status}`);
    } else {
      console.error('❌ Complaint with ID 3 not found');
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating complaint:', error.message);
    console.error(error);
    process.exit(1);
  }
}

updateComplaint();
