# How to Assign Complaints to Engineers Manually

This guide explains how to manually assign complaints to engineers by updating the `AssignTo_id` and `AssignedTime` fields in the database.

## Method 1: Using SQL Script (Recommended)

### Step 1: Connect to your PostgreSQL database

```bash
psql -U your_username -d your_database_name
```

Or use your preferred database client (pgAdmin, DBeaver, etc.)

### Step 2: View Available Engineers

First, see what engineers are available in the system:

```sql
SELECT 
    au.id as engineer_user_id,
    au.first_name,
    au.last_name,
    au.email,
    ce.employee_id,
    ce.designation
FROM auth_user au
LEFT JOIN customer_employee ce ON au.id = ce.auth_user_id
WHERE ce.employee_id IS NOT NULL
ORDER BY au.id;
```

**Note the `engineer_user_id`** - you'll need this for assignment.

### Step 3: View Unassigned Complaints

See which complaints need to be assigned:

```sql
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
```

**Note the complaint `id`** - you'll need this for assignment.

### Step 4: Assign a Complaint

Update the complaint with the engineer's user ID:

```sql
UPDATE firereport_firereport
SET 
    assignto_id = 8,  -- Replace with engineer's auth_user.id from Step 2
    assignedtime = CURRENT_TIMESTAMP,  -- Current date and time
    "Status" = 'Assigned'  -- Update status to Assigned
WHERE id = 1;  -- Replace with complaint ID from Step 3
```

### Step 5: Verify Assignment

Check that the assignment was successful:

```sql
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
WHERE f.id = 1;  -- Replace with complaint ID
```

## Method 2: Using Node.js Helper Script

### Step 1: Navigate to backend directory

```bash
cd backend
```

### Step 2: Run the helper script

```bash
node database/assign_complaint_helper.js <complaintId> <engineerUserId>
```

**Example:**
```bash
node database/assign_complaint_helper.js 1 8
```

This will:
- Assign complaint ID 1 to engineer with user_id 8
- Set AssignedTime to current timestamp
- Update status to 'Assigned'

### What the script does:

1. ✅ Verifies the engineer exists
2. ✅ Verifies the complaint exists
3. ✅ Updates the complaint with assignment details
4. ✅ Shows confirmation of the assignment

## Method 3: Bulk Assignment

### Assign all pending complaints to one engineer:

```sql
UPDATE firereport_firereport
SET 
    assignto_id = 8,  -- Engineer's user_id
    assignedtime = CURRENT_TIMESTAMP,
    "Status" = 'Assigned'
WHERE "Status" = 'Pending' 
  AND assignto_id IS NULL;
```

### Assign multiple specific complaints:

```sql
UPDATE firereport_firereport
SET 
    assignto_id = 8,
    assignedtime = CURRENT_TIMESTAMP,
    "Status" = 'Assigned'
WHERE id IN (1, 2, 3, 4, 5);  -- List of complaint IDs
```

## Unassigning a Complaint

To remove an assignment and set status back to Pending:

```sql
UPDATE firereport_firereport
SET 
    assignto_id = NULL,
    assignedtime = NULL,
    "Status" = 'Pending'
WHERE id = 1;  -- Replace with complaint ID
```

## Important Notes

1. **Field Names**: The database uses:
   - `assignto_id` (lowercase) - foreign key to `auth_user.id`
   - `assignedtime` (lowercase) - timestamp when assigned
   - `"Status"` (quoted, case-sensitive) - complaint status

2. **Status Values**: Valid status values include:
   - `'Pending'` - Not yet assigned
   - `'Assigned'` - Assigned to an engineer
   - `'In Progress'` - Work in progress
   - `'Resolved'` - Completed
   - `'Closed'` - Closed

3. **Timestamps**: 
   - Use `CURRENT_TIMESTAMP` for current date/time
   - Or specify a specific timestamp: `'2024-12-24 06:37:42'`

4. **Verification**: Always verify assignments using the verification query in Step 5 above.

## Example Workflow

```sql
-- 1. Find engineer
SELECT id, first_name, last_name FROM auth_user WHERE email = 'engineer@example.com';
-- Result: id = 8, first_name = 'Salman', last_name = 'Sayyad'

-- 2. Find unassigned complaint
SELECT id, "FullName", "Status" FROM firereport_firereport WHERE assignto_id IS NULL LIMIT 1;
-- Result: id = 1, FullName = 'SANGKAJ STEEL PVT LTD', Status = 'Pending'

-- 3. Assign complaint
UPDATE firereport_firereport
SET assignto_id = 8, assignedtime = CURRENT_TIMESTAMP, "Status" = 'Assigned'
WHERE id = 1;

-- 4. Verify
SELECT f.id, f."Status", au.first_name || ' ' || au.last_name as engineer
FROM firereport_firereport f
LEFT JOIN auth_user au ON f.assignto_id = au.id
WHERE f.id = 1;
```

## Troubleshooting

### Error: "column does not exist"
- Make sure you're using the correct column names: `assignto_id` and `assignedtime` (all lowercase)
- For `Status`, use quotes: `"Status"` (case-sensitive)

### Error: "foreign key constraint"
- Make sure the `engineerUserId` exists in the `auth_user` table
- Check: `SELECT id FROM auth_user WHERE id = <engineerUserId>;`

### Assignment not showing in app
- Clear app cache and refresh
- Verify the assignment in database: `SELECT * FROM firereport_firereport WHERE id = <complaintId>;`
- Check that `assignto_id` is not NULL and `assignedtime` is set
