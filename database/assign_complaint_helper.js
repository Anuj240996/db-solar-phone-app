/**
 * Helper script to assign complaints to engineers
 * 
 * Usage:
 *   node assign_complaint_helper.js <complaintId> <engineerUserId>
 * 
 * Example:
 *   node assign_complaint_helper.js 1 8
 * 
 * This will:
 *   1. Assign complaint ID 1 to engineer with user_id 8
 *   2. Set AssignedTime to current timestamp
 *   3. Update status to 'Assigned'
 */

const pool = require('./database/db');

async function assignComplaint(complaintId, engineerUserId) {
  try {
    // First, verify the engineer exists
    const engineerCheck = await pool.query(
      `SELECT au.id, au.first_name, au.last_name, ce.employee_id, ce.designation
       FROM auth_user au
       LEFT JOIN customer_employee ce ON au.id = ce.auth_user_id
       WHERE au.id = $1`,
      [engineerUserId]
    );

    if (engineerCheck.rows.length === 0) {
      console.error(`❌ Engineer with user_id ${engineerUserId} not found`);
      process.exit(1);
    }

    const engineer = engineerCheck.rows[0];
    console.log(`✅ Found engineer: ${engineer.first_name} ${engineer.last_name} (Employee ID: ${engineer.employee_id || 'N/A'})`);

    // Check if complaint exists
    const complaintCheck = await pool.query(
      `SELECT id, "Status", assignto_id, assignedtime
       FROM firereport_firereport
       WHERE id = $1`,
      [complaintId]
    );

    if (complaintCheck.rows.length === 0) {
      console.error(`❌ Complaint with ID ${complaintId} not found`);
      process.exit(1);
    }

    const complaint = complaintCheck.rows[0];
    console.log(`✅ Found complaint ID ${complaintId}, current status: ${complaint.status || 'N/A'}`);

    if (complaint.assignto_id) {
      console.log(`⚠️  Warning: Complaint is already assigned to engineer_id ${complaint.assignto_id}`);
      console.log(`   This will overwrite the existing assignment.`);
    }

    // Update the complaint
    const result = await pool.query(
      `UPDATE firereport_firereport
       SET 
         assignto_id = $1,
         assignedtime = CURRENT_TIMESTAMP,
         "Status" = 'Assigned'
       WHERE id = $2
       RETURNING id, assignto_id, assignedtime, "Status"`,
      [engineerUserId, complaintId]
    );

    if (result.rows.length > 0) {
      const updated = result.rows[0];
      console.log('\n✅ Complaint assigned successfully!');
      console.log(`   Complaint ID: ${updated.id}`);
      console.log(`   Assigned to Engineer ID: ${updated.assignto_id}`);
      console.log(`   Assigned Time: ${updated.assignedtime}`);
      console.log(`   Status: ${updated.status}`);
    } else {
      console.error('❌ Failed to update complaint');
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error assigning complaint:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: node assign_complaint_helper.js <complaintId> <engineerUserId>');
  console.log('\nExample:');
  console.log('  node assign_complaint_helper.js 1 8');
  console.log('\nThis will assign complaint ID 1 to engineer with user_id 8');
  process.exit(1);
}

const complaintId = parseInt(args[0], 10);
const engineerUserId = parseInt(args[1], 10);

if (isNaN(complaintId) || isNaN(engineerUserId)) {
  console.error('❌ Both complaintId and engineerUserId must be numbers');
  process.exit(1);
}

assignComplaint(complaintId, engineerUserId);
