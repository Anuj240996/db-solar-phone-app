-- Simple script to update complaint ID 3 and add history record
-- Run this in your PostgreSQL database

-- Step 1: Update complaint status and progress_date
UPDATE firereport_firereport 
SET 
    status = 'In Progress',
    progress_date = NOW()
WHERE id = 3;

-- Step 2: Insert history record
-- Note: assignby is required (NOT NULL), so we'll use a default value if not available
-- You may need to adjust the assignby value based on your system

-- First, get the next ID value (handle auto-increment)
DO $$
DECLARE
    v_next_id INTEGER;
    v_assignby INTEGER;
    v_assignto_id INTEGER;
    v_postingdate TEXT;
BEGIN
    -- Get the next ID (find max and add 1, or use sequence if exists)
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_next_id
    FROM firereport_firetequesthistory;
    
    -- Get assignby and assignto_id from the complaint
    SELECT 
        COALESCE(assignby, 1),  -- Default to 1 if NULL
        assignto_id
    INTO v_assignby, v_assignto_id
    FROM firereport_firereport
    WHERE id = 3;
    
    -- Format postingdate as text (YYYY-MM-DD HH:MM:SS format)
    v_postingdate := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    
    -- Insert the record
    INSERT INTO firereport_firetequesthistory (
        id,
        status,
        remark,
        postingdate,
        firereport_id,
        assignto_id,
        assignby
    ) VALUES (
        v_next_id,
        'In Progress',
        'Processing',
        v_postingdate,
        3,
        v_assignto_id,
        v_assignby
    );
    
    RAISE NOTICE 'History record inserted with ID: %', v_next_id;
END $$;

-- Verify the update
SELECT 
    'Complaint Updated' as info,
    id,
    status,
    progress_date,
    assignto_id,
    assignedtime
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
