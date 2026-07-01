# Quick Migration Instructions

Since the Node.js script requires database connection configuration, you can run the SQL directly in your PostgreSQL client.

## Option 1: Using psql Command Line

```bash
psql -U your_username -d your_database_name -f backend/database/add_progress_dates_simple.sql
```

Or if you're already in the database directory:
```bash
psql -U your_username -d your_database_name -f add_progress_dates_simple.sql
```

## Option 2: Copy and Paste SQL Directly

Open your PostgreSQL client (pgAdmin, DBeaver, psql, etc.) and run these commands:

```sql
-- Add progress_date column
ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS progress_date TIMESTAMP;

-- Add working_date column
ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS working_date TIMESTAMP;

-- Add complete_date column
ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS complete_date TIMESTAMP;
```

## Option 3: Using pgAdmin or DBeaver

1. Open your database client
2. Connect to your database
3. Open a SQL query window
4. Copy and paste the SQL from `add_progress_dates_simple.sql`
5. Execute the query

## Verify the Migration

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

You should see all three columns listed.
