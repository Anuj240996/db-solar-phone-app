-- Simple migration to add category and title columns to firereport_firereport table
-- This preserves all existing fields and adds two new columns
-- After migration:
--   - category field will store the complaint category
--   - title field will store the complaint title
--   - message field will store ONLY the description (separate from category/title)
-- Run this in your PostgreSQL database

-- Add category column
ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS category VARCHAR(255);

-- Add title column  
ALTER TABLE firereport_firereport 
ADD COLUMN IF NOT EXISTS title VARCHAR(255);

-- Verify columns were added
SELECT 
    column_name, 
    data_type,
    character_maximum_length
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
AND column_name IN ('category', 'title')
ORDER BY column_name;

-- Show confirmation
SELECT 
    'Migration completed! Category and title columns added.' as status,
    COUNT(*) FILTER (WHERE column_name = 'category') as has_category,
    COUNT(*) FILTER (WHERE column_name = 'title') as has_title
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
AND column_name IN ('category', 'title');
