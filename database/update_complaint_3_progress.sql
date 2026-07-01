-- Update complaint ID 3 with In Progress status and progress_date
-- Also insert a record into firereport_firetequesthistory table

BEGIN;

-- Step 1: Update firereport_firereport table for complaint ID 3
UPDATE firereport_firereport 
SET 
    status = 'In Progress',
    progress_date = NOW()
WHERE id = 3;

-- Verify the update
SELECT 
    id,
    status,
    progress_date,
    assignto_id,
    assignedtime
FROM firereport_firereport 
WHERE id = 3;

-- Step 2: Get the assignby value from the complaint (needed for history record)
-- We'll use a default value or get it from the complaint record
DO $$
DECLARE
    v_assignby INTEGER;
    v_assignto_id INTEGER;
BEGIN
    -- Get assignby and assignto_id from the complaint
    SELECT assignby, assignto_id INTO v_assignby, v_assignto_id
    FROM firereport_firereport
    WHERE id = 3;
    
    -- If assignby is NULL, set a default value (you may need to adjust this)
    IF v_assignby IS NULL THEN
        v_assignby := 1; -- Default admin user ID (adjust as needed)
    END IF;
    
    -- Insert into firereport_firetequesthistory
    INSERT INTO firereport_firetequesthistory (
        status,
        remark,
        postingdate,
        firereport_id,
        assignto_id,
        assignby
    ) VALUES (
        'In Progress',
        'Processing',
        NOW()::text,  -- postingdate is TEXT type in the database
        3,
        v_assignto_id,
        v_assignby
    );
    
    RAISE NOTICE 'History record inserted successfully';
END $$;

-- Verify the history record was inserted
SELECT 
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

COMMIT;
