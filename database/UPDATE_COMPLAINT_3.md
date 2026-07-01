# Update Complaint #3

## Quick SQL Command

Run this SQL command directly in your PostgreSQL database:

```sql
UPDATE firereport_firereport
SET 
    assignto_id = 8,
    assignedtime = CURRENT_TIMESTAMP,
    "Status" = 'Assigned'
WHERE id = 3;
```

## Verify the Update

```sql
SELECT 
    id,
    "FullName" as full_name,
    "Status" as status,
    assignto_id,
    assignedtime
FROM firereport_firereport
WHERE id = 3;
```

## Using Node.js Script

If you want to use the script, run from the project root:

```bash
node backend/update_complaint_3.js
```

Or from the backend directory:

```bash
cd backend
node update_complaint_3.js
```
