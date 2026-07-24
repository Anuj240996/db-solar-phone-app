-- Working script to update complaint ID 3 and add history record
-- This explicitly handles the ID field which is NOT NULL

-- Step 1: Update complaint status and progress_date
UPDATE firereport_firereport 
SET 
    status = 'In Progress',
    progress_date = NOW()
WHERE id = 3;

-- Step 2: Insert history record
-- Get the next ID by finding the maximum and adding 1
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
    COALESCE(assignto_id, NULL) as assignto_id,
    COALESCE(assignby, 1) as assignby  -- Default to 1 if NULL (assignby is NOT NULL)
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

-- Verify the history record was inserted
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
LIMIT 5;
