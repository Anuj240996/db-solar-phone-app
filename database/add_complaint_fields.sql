-- Migration script to add category and title fields to firereport_firereport table
-- Run this script if the category and title columns don't exist

-- Add category column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'firereport_firereport' 
        AND column_name = 'category'
    ) THEN
        ALTER TABLE firereport_firereport 
        ADD COLUMN category character varying(100);
    END IF;
END $$;

-- Add title column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'firereport_firereport' 
        AND column_name = 'title'
    ) THEN
        ALTER TABLE firereport_firereport 
        ADD COLUMN title character varying(200);
    END IF;
END $$;
