const pool = require('./db');

async function updateComplaint3() {
  try {
    console.log('Updating complaint ID 3 with In Progress status and progress_date...');
    
    // Step 1: Update the complaint
    const updateResult = await pool.query(`
      UPDATE firereport_firereport 
      SET 
        status = 'In Progress',
        progress_date = NOW()
      WHERE id = 3
      RETURNING id, status, progress_date, assignto_id, assignedtime, assignby
    `);
    
    if (updateResult.rows.length === 0) {
      console.log('❌ Complaint ID 3 not found');
      process.exit(1);
    }
    
    const complaint = updateResult.rows[0];
    console.log('✅ Complaint updated:', {
      id: complaint.id,
      status: complaint.status,
      progress_date: complaint.progress_date,
      assignto_id: complaint.assignto_id,
      assignedtime: complaint.assignedtime,
    });
    
    // Step 2: Get the next ID for the history record
    const maxIdResult = await pool.query(`
      SELECT COALESCE(MAX(id), 0) as max_id
      FROM firereport_firetequesthistory
    `);
    const nextId = (maxIdResult.rows[0].max_id || 0) + 1;
    
    // Step 3: Insert history record
    const assignby = complaint.assignby || 1; // Default to 1 if NULL
    const assignto_id = complaint.assignto_id;
    
    // Format date as YYYY-MM-DD HH:MM:SS for postingdate (TEXT field)
    const now = new Date();
    const postingdate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    console.log('📝 Inserting history record with:', {
      id: nextId,
      status: 'In Progress',
      remark: 'Processing',
      postingdate: postingdate,
      firereport_id: 3,
      assignto_id: assignto_id,
      assignby: assignby,
    });
    
    const historyResult = await pool.query(`
      INSERT INTO firereport_firetequesthistory (
        id,
        status,
        remark,
        postingdate,
        firereport_id,
        assignto_id,
        assignby
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, status, remark, postingdate, firereport_id
    `, [
      nextId,
      'In Progress',
      'Processing',
      postingdate, // postingdate is TEXT, format as YYYY-MM-DD HH:MM:SS
      3,
      assignto_id,
      assignby
    ]);
    
    console.log('✅ History record inserted:', historyResult.rows[0]);
    
    // Step 3: Verify both records
    const verifyComplaint = await pool.query(`
      SELECT id, status, progress_date, assignto_id, assignedtime
      FROM firereport_firereport
      WHERE id = 3
    `);
    
    const verifyHistory = await pool.query(`
      SELECT id, status, remark, postingdate, firereport_id
      FROM firereport_firetequesthistory
      WHERE firereport_id = 3
      ORDER BY id DESC
      LIMIT 5
    `);
    
    console.log('\n📊 Verification:');
    console.log('Complaint:', verifyComplaint.rows[0]);
    console.log('History Records:', verifyHistory.rows);
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

updateComplaint3();
