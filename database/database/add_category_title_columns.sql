-- Migration script to add category and title columns to firereport_firereport table
-- This allows category and title to be stored separately from the message field

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
        
        RAISE NOTICE '✅ Category column added successfully';
    ELSE
        RAISE NOTICE 'ℹ️  Category column already exists';
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
        
        RAISE NOTICE '✅ Title column added successfully';
    ELSE
        RAISE NOTICE 'ℹ️  Title column already exists';
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

-- Show success message
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE 'Migration completed!';
    RAISE NOTICE '';
    RAISE NOTICE 'Now category and title will be stored in separate columns';
    RAISE NOTICE 'and message field will contain only the description.';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;
