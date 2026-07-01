-- Migration script to add category and title columns to firereport_firereport table
-- This script preserves all existing fields and adds the new columns
-- All date fields will use system dates appropriately based on their names

-- Add category column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'firereport_firereport' 
        AND column_name = 'category'
    ) THEN
        ALTER TABLE public.firereport_firereport 
        ADD COLUMN category VARCHAR(255);
        
        RAISE NOTICE 'Category column added successfully';
    ELSE
        RAISE NOTICE 'Category column already exists';
    END IF;
END $$;

-- Add title column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'firereport_firereport' 
        AND column_name = 'title'
    ) THEN
        ALTER TABLE public.firereport_firereport 
        ADD COLUMN title VARCHAR(255);
        
        RAISE NOTICE 'Title column added successfully';
    ELSE
        RAISE NOTICE 'Title column already exists';
    END IF;
END $$;

-- Verify the columns were added
SELECT 
    column_name, 
    data_type, 
    character_maximum_length,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
AND column_name IN ('category', 'title')
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
