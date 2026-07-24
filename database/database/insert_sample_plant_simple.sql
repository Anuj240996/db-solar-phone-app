-- Simple INSERT statement for sample plant
-- Make sure to replace NULL with your actual Growatt Plant ID after inserting

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
    yearly_generation,
    growatt_plant_id,
    created_at,
    updated_at
)
SELECT 
    gen_random_uuid(),
    (SELECT id FROM auth_user WHERE id = 220 LIMIT 1),
    'Heramb Industries Solar Plant',
    'Mumbai, Maharashtra',
    50.00,
    'active',
    CURRENT_DATE - INTERVAL '6 months',
    25.5,
    750.0,
    1250.0,
    NULL, -- TODO: Replace with your Growatt Plant ID from Growatt dashboard
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    -- Only insert if no plants exist for this user
    SELECT 1 FROM plants 
    WHERE user_id = (SELECT id FROM auth_user WHERE id = 220 LIMIT 1)
);
