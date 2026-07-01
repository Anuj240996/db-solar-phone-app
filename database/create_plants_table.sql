-- Create plants table if it doesn't exist
-- This table stores solar plant information and links to Growatt API

CREATE TABLE IF NOT EXISTS plants (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    capacity DECIMAL(10, 2) NOT NULL, -- Plant capacity in kW
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, inactive, maintenance
    installation_date DATE NOT NULL,
    daily_generation DECIMAL(10, 2), -- Daily generation in kWh
    monthly_generation DECIMAL(10, 2), -- Monthly generation in kWh
    yearly_generation DECIMAL(10, 2), -- Yearly generation in kWh
    lifetime_generation DECIMAL(10, 2), -- Lifetime generation in kWh
    efficiency DECIMAL(5, 2), -- Efficiency percentage
    health_metrics JSONB, -- JSON object for health metrics
    growatt_plant_id VARCHAR(255), -- Growatt plant ID for API integration
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key constraint (if users table exists)
    CONSTRAINT fk_plants_user 
        FOREIGN KEY (user_id) 
        REFERENCES auth_user(id) 
        ON DELETE CASCADE
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_plants_user_id ON plants(user_id);

-- Create index on growatt_plant_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_plants_growatt_id ON plants(growatt_plant_id);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_plants_status ON plants(status);

-- Add comments for documentation
COMMENT ON TABLE plants IS 'Stores solar plant information and links to Growatt API';
COMMENT ON COLUMN plants.growatt_plant_id IS 'Growatt API plant ID used for fetching real-time generation data';
COMMENT ON COLUMN plants.capacity IS 'Plant capacity in kilowatts (kW)';
COMMENT ON COLUMN plants.daily_generation IS 'Daily energy generation in kilowatt-hours (kWh)';
COMMENT ON COLUMN plants.monthly_generation IS 'Monthly energy generation in kilowatt-hours (kWh)';
COMMENT ON COLUMN plants.yearly_generation IS 'Yearly energy generation in kilowatt-hours (kWh)';
COMMENT ON COLUMN plants.lifetime_generation IS 'Total lifetime energy generation in kilowatt-hours (kWh)';
COMMENT ON COLUMN plants.efficiency IS 'Plant efficiency as a percentage';
