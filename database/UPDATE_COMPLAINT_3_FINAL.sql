-- Final working SQL script to update complaint ID 3 and add history record
-- Copy and paste this directly into your PostgreSQL client (pgAdmin, DBeaver, psql, etc.)

-- Step 1: Update complaint status and progress_date
UPDATE firereport_firereport 
SET 
    status = 'In Progress',
    progress_date = NOW()
WHERE id = 3;

-- Step 2: Insert history record
-- This calculates the next ID automatically and handles all required fields
INSERT INTO firereport_firetequesthistory (
    id,
    status,
    remark,
    postingdate,
    firereport_id,
    assignto_id,
    assignby
)
SELECT 
    (SELECT COALESCE(MAX(id), 0) FROM firereport_firetequesthistory) + 1 as id,
    'In Progress' as status,
    'Processing' as remark,
    TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS') as postingdate,
    3 as firereport_id,
    assignto_id,
    COALESCE(assignby, 1) as assignby
FROM firereport_firereport
WHERE id = 3;

-- Step 3: Verify the update
SELECT 
    '✅ Complaint Updated' as status,
    id,
    status,
    progress_date,
    assignto_id,
    assignedtime,
    assignby
FROM firereport_firereport 
WHERE id = 3;

-- Step 4: Verify the history record was inserted
SELECT 
    '✅ History Record Added' as status,
    id,
    status,
    remark,
    postingdate,
    firereport_id,
    assignto_id,
    assignby
FROM firereport_firetequesthistory
WHERE firereport_id = 3
ORDER BY id DESC
LIMIT 5;
