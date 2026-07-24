-- Add plant_id column to growatt_credentials table
-- This will store the plant ID(s) associated with the Growatt account
-- Using JSONB to support multiple plants per account

ALTER TABLE growatt_credentials 
ADD COLUMN IF NOT EXISTS plant_ids JSONB DEFAULT '[]'::jsonb;

-- Add comment
COMMENT ON COLUMN growatt_credentials.plant_ids IS 'Array of plant IDs associated with this Growatt account, stored as JSON array: ["2035825", "2035826"]';
