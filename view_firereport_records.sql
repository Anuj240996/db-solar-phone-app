-- SQL Queries to View firereport_firereport Records
-- Copy and paste these queries into pgAdmin Query Tool

-- ============================================
-- Query 1: View All Records (All Columns)
-- ============================================
SELECT * 
FROM firereport_firereport
ORDER BY postingdate DESC;

-- ============================================
-- Query 2: View All Records (Important Columns)
-- ============================================
SELECT 
    id,
    fullname,
    mobilenumber,
    "Location",
    category,
    title,
    message,
    status,
    postingdate,
    account_id,
    assignby
FROM firereport_firereport
ORDER BY postingdate DESC;

-- ============================================
-- Query 3: View Latest 10 Records
-- ============================================
SELECT 
    id,
    fullname,
    mobilenumber,
    "Location",
    category,
    title,
    LEFT(message, 100) as message_preview,
    status,
    postingdate
FROM firereport_firereport
ORDER BY postingdate DESC
LIMIT 10;

-- ============================================
-- Query 4: View Records for Specific User
-- Replace 65 with your actual user ID
-- ============================================
SELECT 
    id,
    fullname,
    mobilenumber,
    "Location",
    category,
    title,
    message,
    status,
    postingdate
FROM firereport_firereport
WHERE account_id = 65
ORDER BY postingdate DESC;

-- ============================================
-- Query 5: Verify Category and Title Storage
-- This shows if category/title are stored separately
-- ============================================
SELECT 
    id,
    category,
    title,
    CASE 
        WHEN message LIKE '[Category:%' THEN 'Has embedded category/title (old format)'
        ELSE 'Clean description only (new format)'
    END as message_format,
    LEFT(message, 100) as message_preview
FROM firereport_firereport
ORDER BY postingdate DESC
LIMIT 10;

-- ============================================
-- Query 6: Count Records by Status
-- ============================================
SELECT 
    status,
    COUNT(*) as count
FROM firereport_firereport
GROUP BY status
ORDER BY count DESC;

-- ============================================
-- Query 7: Count Records by Category
-- ============================================
SELECT 
    category,
    COUNT(*) as count
FROM firereport_firereport
WHERE category IS NOT NULL
GROUP BY category
ORDER BY count DESC;

-- ============================================
-- Query 8: View Today's Complaints
-- ============================================
SELECT 
    id,
    fullname,
    category,
    title,
    status,
    postingdate
FROM firereport_firereport
WHERE postingdate::date = CURRENT_DATE
ORDER BY postingdate DESC;

-- ============================================
-- Query 9: View Table Structure
-- ============================================
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'firereport_firereport' 
ORDER BY ordinal_position;
