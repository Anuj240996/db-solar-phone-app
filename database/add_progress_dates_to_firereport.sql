-- Migration script to add progress_date, working_date, and complete_date columns to firereport_firereport table
-- These fields track the progress stages of complaint handling
-- All fields are nullable to allow for incremental updates

-- Add progress_date column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'firereport_firereport' 
        AND column_name = 'progress_date'
    ) THEN
        ALTER TABLE public.firereport_firereport 
        ADD COLUMN progress_date TIMESTAMP;
        
        RAISE NOTICE 'progress_date column added successfully';
    ELSE
        RAISE NOTICE 'progress_date column already exists';
    END IF;
END $$;

-- Add working_date column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'firereport_firereport' 
        AND column_name = 'working_date'
    ) THEN
        ALTER TABLE public.firereport_firereport 
        ADD COLUMN working_date TIMESTAMP;
        
        RAISE NOTICE 'working_date column added successfully';
    ELSE
        RAISE NOTICE 'working_date column already exists';
    END IF;
END $$;

-- Add complete_date column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'firereport_firereport' 
        AND column_name = 'complete_date'
    ) THEN
        ALTER TABLE public.firereport_firereport 
        ADD COLUMN complete_date TIMESTAMP;
        
        RAISE NOTICE 'complete_date column added successfully';
    ELSE
        RAISE NOTICE 'complete_date column already exists';
    END IF;
END $$;

-- Verify the columns were added
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

-- Display all columns in the table for verification
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
ORDER BY ordinal_position;
