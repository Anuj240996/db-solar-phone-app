# How to Add Progress Date Fields to firereport_firereport Table

This guide explains how to add the three new datetime fields (`progress_date`, `working_date`, `complete_date`) to the `firereport_firereport` table.

## Fields to Add

- `progress_date` (TIMESTAMP) - Date when complaint progress started
- `working_date` (TIMESTAMP) - Date when work on the complaint began
- `complete_date` (TIMESTAMP) - Date when complaint was completed

All fields are nullable to allow for incremental updates.

## Method 1: Using Node.js Script (Recommended)

Run the Node.js migration script:

```bash
cd backend/database
node run_progress_dates_migration.js
```

This script will:
1. Execute the SQL migration
2. Verify that the columns were added
3. Display confirmation messages

## Method 2: Using Simple SQL Script

Run the simple SQL script directly in your PostgreSQL database:

```bash
psql -U your_username -d your_database -f add_progress_dates_simple.sql
```

Or using the full migration script:

```bash
psql -U your_username -d your_database -f add_progress_dates_to_firereport.sql
```

## Method 3: Manual SQL Execution

You can also run the SQL commands manually in your PostgreSQL client:

```sql
ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS progress_date TIMESTAMP;

ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS working_date TIMESTAMP;

ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS complete_date TIMESTAMP;
```

## Verification

After running the migration, verify the columns were added:

```sql
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
AND column_name IN ('progress_date', 'working_date', 'complete_date')
ORDER BY column_name;
```

## Usage in Backend

After adding these fields, you can update them in your backend code:

```javascript
// Example: Update progress_date
await pool.query(
  `UPDATE firereport_firereport 
   SET progress_date = NOW() 
   WHERE id = $1`,
  [complaintId]
);

// Example: Update working_date
await pool.query(
  `UPDATE firereport_firereport 
   SET working_date = NOW() 
   WHERE id = $1`,
  [complaintId]
);

// Example: Update complete_date
await pool.query(
  `UPDATE firereport_firereport 
   SET complete_date = NOW() 
   WHERE id = $1`,
  [complaintId]
);
```

## Notes

- All three fields are nullable (can be NULL)
- Fields use TIMESTAMP data type (equivalent to DATETIME in PostgreSQL)
- The migration is idempotent (safe to run multiple times)
- Existing records will have NULL values for these fields until updated
