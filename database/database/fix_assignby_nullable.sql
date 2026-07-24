-- Fix assignby column to allow NULL values for new complaints
-- This allows assignby to be NULL when creating complaints (will be assigned later)

-- Remove NOT NULL constraint from assignby column
ALTER TABLE firereport_firereport 
ALTER COLUMN assignby DROP NOT NULL;

-- Verify the change
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
AND column_name = 'assignby';

-- Show confirmation
SELECT 
    'assignby column is now nullable - can be NULL for new complaints' as status;
