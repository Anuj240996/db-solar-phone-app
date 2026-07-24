-- Simple migration to add progress_date, working_date, and complete_date columns to firereport_firereport table
-- These fields track the progress stages of complaint handling
-- All fields are nullable TIMESTAMP to allow for incremental updates
-- Run this in your PostgreSQL database

-- Add progress_date column
ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS progress_date TIMESTAMP;

-- Add working_date column
ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS working_date TIMESTAMP;

-- Add complete_date column
ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS complete_date TIMESTAMP;

-- Verify columns were added
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
AND column_name IN ('progress_date', 'working_date', 'complete_date')
ORDER BY column_name;

-- Show confirmation
SELECT 
    'Migration completed! Progress date columns added.' as status,
    COUNT(*) FILTER (WHERE column_name = 'progress_date') as has_progress_date,
    COUNT(*) FILTER (WHERE column_name = 'working_date') as has_working_date,
    COUNT(*) FILTER (WHERE column_name = 'complete_date') as has_complete_date
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
AND column_name IN ('progress_date', 'working_date', 'complete_date');
