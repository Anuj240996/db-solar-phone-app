-- View complete structure of firereport_firereport table after migration
-- This shows all fields including the newly added category and title columns

-- Method 1: Show all columns with details
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default,
    ordinal_position
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
ORDER BY ordinal_position;

-- Method 2: Show column names only (simpler view)
SELECT 
    column_name,
    data_type,
    CASE 
        WHEN character_maximum_length IS NOT NULL 
        THEN data_type || '(' || character_maximum_length || ')'
        ELSE data_type
    END as full_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
ORDER BY ordinal_position;

-- Method 3: Show CREATE TABLE equivalent structure
SELECT 
    'CREATE TABLE firereport_firereport (' || 
    string_agg(
        column_name || ' ' || 
        CASE 
            WHEN data_type = 'character varying' THEN 'VARCHAR(' || character_maximum_length || ')'
            WHEN data_type = 'integer' THEN 'INTEGER'
            WHEN data_type = 'text' THEN 'TEXT'
            WHEN data_type = 'timestamp without time zone' THEN 'DATETIME'
            WHEN data_type = 'timestamp with time zone' THEN 'DATETIME'
            ELSE UPPER(data_type)
        END ||
        CASE 
            WHEN is_nullable = 'NO' THEN ' NOT NULL'
            ELSE ''
        END,
        E',\n    '
        ORDER BY ordinal_position
    ) || 
    ');' as create_table_statement
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport';

-- Method 4: Count total columns
SELECT 
    COUNT(*) as total_columns,
    COUNT(CASE WHEN column_name IN ('category', 'title') THEN 1 END) as new_columns_added
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport';
