-- Insert sample plant data for user ID 220
-- This script handles UUID type for user_id

-- First, get the UUID for user ID 220
-- Then insert a sample plant if none exists for this user

DO $$
DECLARE
    v_user_id uuid;
    v_plant_id uuid;
BEGIN
    -- Get the UUID for user ID 220 from auth_user
    SELECT id INTO v_user_id
    FROM auth_user
    WHERE id = 220
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'User ID 220 not found in auth_user table';
        RETURN;
    END IF;

    RAISE NOTICE 'Found user UUID: %', v_user_id;

    -- Check if plant already exists for this user
    IF EXISTS (SELECT 1 FROM plants WHERE user_id = v_user_id) THEN
        RAISE NOTICE 'Plant already exists for this user. Skipping insert.';
        RETURN;
    END IF;

    -- Generate a new UUID for the plant
    v_plant_id := gen_random_uuid();

    -- Insert sample plant
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
    ) VALUES (
        v_plant_id,
        v_user_id,
        'Heramb Industries Solar Plant',
        'Mumbai, Maharashtra',
        50.00, -- 50 kW capacity
        'active',
        CURRENT_DATE - INTERVAL '6 months',
        25.5, -- Sample daily generation in kWh
        750.0, -- Sample monthly generation in kWh
        1250.0, -- Sample yearly generation in kWh
        NULL, -- Replace with your Growatt plant ID when you have it
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

    RAISE NOTICE '✅ Sample plant inserted successfully with ID: %', v_plant_id;
    RAISE NOTICE '💡 Remember to update growatt_plant_id with your actual Growatt Plant ID';
    RAISE NOTICE '   UPDATE plants SET growatt_plant_id = ''YOUR_GROWATT_PLANT_ID'' WHERE id = ''%'';', v_plant_id;
END $$;

-- Verify the insert
SELECT 
    id,
    name,
    location,
    capacity,
    status,
    growatt_plant_id,
    created_at
FROM plants 
WHERE user_id = (SELECT id FROM auth_user WHERE id = 220 LIMIT 1);

COMMENT ON TABLE plants IS 'To find your Growatt Plant ID: 
1. Login to Growatt dashboard (https://server.growatt.com)
2. Go to Plant List  
3. Copy the Plant ID for your plant
4. Update this value in the plants table using: 
   UPDATE plants SET growatt_plant_id = ''YOUR_PLANT_ID'' WHERE id = ''YOUR_PLANT_ID_IN_DB'';';
