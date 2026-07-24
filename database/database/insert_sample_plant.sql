-- Insert sample plant data for testing
-- Replace user_id with your actual user ID (from login, it's 220)
-- Replace growatt_plant_id with your actual Growatt plant ID from the Growatt dashboard

-- First, check if you have plants. If not, insert a sample one.
INSERT INTO plants (
    id,
    user_id,
    name,
    location,
    capacity,
    status,
    installation_date,
    daily_generation,
    monthly_generation,
    growatt_plant_id,
    created_at,
    updated_at
)
SELECT 
    gen_random_uuid()::text,
    220, -- Replace with your user ID
    'Heramb Industries Solar Plant',
    'Mumbai, Maharashtra',
    50.00, -- 50 kW capacity
    'active',
    CURRENT_DATE - INTERVAL '6 months',
    25.5, -- Sample daily generation in kWh
    750.0, -- Sample monthly generation in kWh
    NULL, -- Replace with your Growatt plant ID when you have it
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    -- Only insert if no plants exist for this user
    SELECT 1 FROM plants WHERE user_id = 220
);

-- If you want to update an existing plant with Growatt ID, use:
-- UPDATE plants 
-- SET growatt_plant_id = 'YOUR_GROWATT_PLANT_ID_HERE'
-- WHERE user_id = 220 AND id = 'YOUR_PLANT_ID_HERE';

COMMENT ON TABLE plants IS 'To find your Growatt Plant ID: 
1. Login to Growatt dashboard (https://server.growatt.com)
2. Go to Plant List
3. Copy the Plant ID for your plant
4. Update this value in the plants table using: 
   UPDATE plants SET growatt_plant_id = ''YOUR_PLANT_ID'' WHERE id = ''YOUR_PLANT_ID_IN_DB'';';
