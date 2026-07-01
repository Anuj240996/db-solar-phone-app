-- Add growatt_plant_id column to existing plants table if it doesn't exist
-- This column links your database plants to Growatt API plant IDs

DO $$ 
BEGIN
    -- Check if column exists, if not add it
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'plants' 
        AND column_name = 'growatt_plant_id'
    ) THEN
        ALTER TABLE plants 
        ADD COLUMN growatt_plant_id VARCHAR(255);
        
        -- Create index on the new column
        CREATE INDEX IF NOT EXISTS idx_plants_growatt_id ON plants(growatt_plant_id);
        
        -- Add comment
        COMMENT ON COLUMN plants.growatt_plant_id IS 'Growatt API plant ID used for fetching real-time generation data';
        
        RAISE NOTICE 'Added growatt_plant_id column to plants table';
    ELSE
        RAISE NOTICE 'Column growatt_plant_id already exists in plants table';
    END IF;
END $$;
