-- Fixed script to update complaint ID 3 and add history record
-- This handles the ID field and ensures all required fields are populated

-- Step 1: Update complaint status and progress_date
UPDATE firereport_firereport 
SET 
    status = 'In Progress',
    progress_date = NOW()
WHERE id = 3;

-- Step 2: Insert history record with proper ID handling
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
    COALESCE((SELECT MAX(id) FROM firereport_firetequesthistory), 0) + 1 as id,
    'In Progress' as status,
    'Processing' as remark,
    TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS') as postingdate,
    3 as firereport_id,
    assignto_id,
    COALESCE(assignby, 1) as assignby  -- Use assignby from complaint, or default to 1 if NULL
FROM firereport_firereport
WHERE id = 3;

-- Verify the update
SELECT 
    'Complaint Updated' as info,
    id,
    status,
    progress_date,
    assignto_id,
    assignedtime,
    assignby
FROM firereport_firereport 
WHERE id = 3;

-- Verify the history record
SELECT 
    'History Record Added' as info,
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
LIMIT 1;
