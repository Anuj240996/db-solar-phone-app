-- Update complaint record #3
-- Set assignto_id to 8 and assignedtime to current timestamp

UPDATE firereport_firereport
SET 
    assignto_id = 8,
    assignedtime = CURRENT_TIMESTAMP,
    "Status" = 'Assigned'
WHERE id = 3;

-- Verify the update
SELECT 
    id,
    "FullName" as full_name,
    "Status" as status,
    assignto_id,
    assignedtime
FROM firereport_firereport
WHERE id = 3;
