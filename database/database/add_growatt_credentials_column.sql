-- Add growatt_credentials table if it doesn't exist
-- This script is idempotent - safe to run multiple times

DO $$ 
BEGIN
    -- Check if table exists, if not create it
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'growatt_credentials'
    ) THEN
        CREATE TABLE growatt_credentials (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            username VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            CONSTRAINT unique_user_growatt 
                UNIQUE (user_id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_growatt_credentials_user_id ON growatt_credentials(user_id);
        
        -- Try to add foreign key constraint (may fail if auth_user.id is not unique)
        BEGIN
            ALTER TABLE growatt_credentials 
            ADD CONSTRAINT fk_growatt_user 
                FOREIGN KEY (user_id) 
                REFERENCES auth_user(id) 
                ON DELETE CASCADE;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not add foreign key constraint (auth_user.id may not be unique): %', SQLERRM;
        END;
        
        RAISE NOTICE 'Created growatt_credentials table';
    ELSE
        RAISE NOTICE 'Table growatt_credentials already exists';
    END IF;
END $$;
