# How to Update Complaint ID 3 with Progress Status

This guide explains how to update complaint ID 3 with "In Progress" status and add a history record.

## What This Does

1. **Updates `firereport_firereport` table:**
   - Sets `status` = 'In Progress'
   - Sets `progress_date` = Current DateTime

2. **Inserts into `firereport_firetequesthistory` table:**
   - `firereport_id` = 3
   - `status` = 'In Progress'
   - `remark` = 'Processing'
   - `postingdate` = Current DateTime
   - `assignto_id` = From the complaint record
   - `assignby` = From the complaint record (or default to 1 if NULL)

## Method 1: Using Node.js Script (Recommended)

```bash
cd backend/database
node update_complaint_3_helper.js
```

## Method 2: Using Simple SQL Script

Run the SQL script directly in your PostgreSQL database:

```bash
psql -U your_username -d your_database -f update_complaint_3_progress_simple.sql
```

## Method 3: Manual SQL Execution

Copy and paste this SQL into your PostgreSQL client:

```sql
-- Update complaint
UPDATE firereport_firereport 
SET 
    status = 'In Progress',
    progress_date = NOW()
WHERE id = 3;

-- Insert history record
INSERT INTO firereport_firetequesthistory (
    status,
    remark,
    postingdate,
    firereport_id,
    assignto_id,
    assignby
)
SELECT 
    'In Progress' as status,
    'Processing' as remark,
    NOW()::text as postingdate,
    3 as firereport_id,
    assignto_id,
    COALESCE(assignby, 1) as assignby
FROM firereport_firereport
WHERE id = 3;
```

## Verification

After running the update, verify the changes:

```sql
-- Check complaint
SELECT 
    id,
    status,
    progress_date,
    assignto_id,
    assignedtime
FROM firereport_firereport 
WHERE id = 3;

-- Check history
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
ORDER BY id DESC;
```

## Notes

- The `assignby` field in `firereport_firetequesthistory` is NOT NULL, so if the complaint's `assignby` is NULL, it will default to 1 (you may need to adjust this based on your system)
- The `postingdate` field in `firereport_firetequesthistory` is TEXT type, so we store the date as a text string
- Make sure complaint ID 3 exists before running this script
