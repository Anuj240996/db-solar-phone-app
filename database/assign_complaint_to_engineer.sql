-- Script to manually assign complaints to engineers
-- This updates the AssignTo_id and AssignedTime fields in firereport_firereport table

-- ============================================
-- STEP 1: View available engineers
-- ============================================
-- First, let's see what engineers are available in the system
SELECT 
    au.id as engineer_user_id,
    au.first_name,
    au.last_name,
    au.email,
    ce.employee_id,
    ce.designation
FROM auth_user au
LEFT JOIN customer_employee ce ON au.id = ce.auth_user_id
WHERE ce.employee_id IS NOT NULL  -- Only show employees (engineers)
ORDER BY au.id;

-- ============================================
-- STEP 2: View unassigned complaints
-- ============================================
-- See which complaints are not yet assigned
SELECT 
    id,
    "FullName" as full_name,
    "Message" as message,
    "Status" as status,
    "Postingdate" as posting_date,
    assignto_id,
    assignedtime
FROM firereport_firereport
WHERE assignto_id IS NULL
ORDER BY id DESC;

-- ============================================
-- STEP 3: Assign a complaint to an engineer
-- ============================================
-- Replace the values below:
--   - COMPLAINT_ID: The ID of the complaint you want to assign
--   - ENGINEER_USER_ID: The auth_user.id of the engineer (from Step 1)
--   - ASSIGNED_TIME: The timestamp when assignment happens (use CURRENT_TIMESTAMP for now, or a specific date)

-- Example 1: Assign complaint ID 1 to engineer with user_id 8, set status to 'Assigned'
UPDATE firereport_firereport
SET 
    assignto_id = 8,  -- Replace with actual engineer's auth_user.id
    assignedtime = CURRENT_TIMESTAMP,  -- Current date and time
    "Status" = 'Assigned'  -- Update status to Assigned
WHERE id = 1;  -- Replace with actual complaint ID

-- Example 2: Assign multiple complaints to the same engineer
UPDATE firereport_firereport
SET 
    assignto_id = 8,  -- Engineer's user_id
    assignedtime = CURRENT_TIMESTAMP,
    "Status" = 'Assigned'
WHERE id IN (1, 2, 3);  -- Multiple complaint IDs

-- Example 3: Assign with a specific timestamp
UPDATE firereport_firereport
SET 
    assignto_id = 8,
    assignedtime = '2024-12-24 06:37:42',  -- Specific date and time
    "Status" = 'Assigned'
WHERE id = 1;

-- ============================================
-- STEP 4: Verify the assignment
-- ============================================
-- Check that the complaint was assigned correctly
SELECT 
    f.id as complaint_id,
    f."FullName" as consumer_name,
    f."Status" as status,
    f.assignto_id,
    f.assignedtime,
    au.first_name || ' ' || au.last_name as engineer_name,
    ce.employee_id,
    ce.designation
FROM firereport_firereport f
LEFT JOIN auth_user au ON f.assignto_id = au.id
LEFT JOIN customer_employee ce ON au.id = ce.auth_user_id
WHERE f.id = 1;  -- Replace with complaint ID you just assigned

-- ============================================
-- STEP 5: Unassign a complaint (if needed)
-- ============================================
-- To remove assignment and set status back to Pending
UPDATE firereport_firereport
SET 
    assignto_id = NULL,
    assignedtime = NULL,
    "Status" = 'Pending'
WHERE id = 1;  -- Replace with complaint ID

-- ============================================
-- BULK ASSIGNMENT EXAMPLE
-- ============================================
-- Assign all pending complaints to a specific engineer
UPDATE firereport_firereport
SET 
    assignto_id = 8,  -- Engineer's user_id
    assignedtime = CURRENT_TIMESTAMP,
    "Status" = 'Assigned'
WHERE "Status" = 'Pending' 
  AND assignto_id IS NULL;
