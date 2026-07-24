-- Create table to store Growatt API credentials for each user
-- These credentials are saved once and used for automatic data fetching

CREATE TABLE IF NOT EXISTS growatt_credentials (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL, -- Encrypted/stored securely
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- One credential set per user
    CONSTRAINT fk_growatt_user 
        FOREIGN KEY (user_id) 
        REFERENCES auth_user(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT unique_user_growatt 
        UNIQUE (user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_growatt_credentials_user_id ON growatt_credentials(user_id);

-- Add comments
COMMENT ON TABLE growatt_credentials IS 'Stores Growatt API credentials for each user to enable automatic real-time data fetching';
COMMENT ON COLUMN growatt_credentials.user_id IS 'Foreign key to auth_user.id';
COMMENT ON COLUMN growatt_credentials.username IS 'Growatt account username';
COMMENT ON COLUMN growatt_credentials.password IS 'Growatt account password (should be encrypted in production)';
