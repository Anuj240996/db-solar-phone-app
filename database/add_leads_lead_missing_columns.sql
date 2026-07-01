-- Add missing columns to existing leads_lead table (safe to run multiple times)
-- Run: psql -d db_solar -f backend/database/add_leads_lead_missing_columns.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'name') THEN
    ALTER TABLE leads_lead ADD COLUMN name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'property_type') THEN
    ALTER TABLE leads_lead ADD COLUMN property_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'roof_type') THEN
    ALTER TABLE leads_lead ADD COLUMN roof_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'electricity_bill') THEN
    ALTER TABLE leads_lead ADD COLUMN electricity_bill TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'monthly_consumption') THEN
    ALTER TABLE leads_lead ADD COLUMN monthly_consumption TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'sorting_address') THEN
    ALTER TABLE leads_lead ADD COLUMN sorting_address TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'city') THEN
    ALTER TABLE leads_lead ADD COLUMN city TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'state') THEN
    ALTER TABLE leads_lead ADD COLUMN state TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'pincode') THEN
    ALTER TABLE leads_lead ADD COLUMN pincode TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'email') THEN
    ALTER TABLE leads_lead ADD COLUMN email TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'contact') THEN
    ALTER TABLE leads_lead ADD COLUMN contact TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'stage') THEN
    ALTER TABLE leads_lead ADD COLUMN stage TEXT NOT NULL DEFAULT 'new_app';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'payment_mode') THEN
    ALTER TABLE leads_lead ADD COLUMN payment_mode TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'user_app_id') THEN
    ALTER TABLE leads_lead ADD COLUMN user_app_id BIGINT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'lat') THEN
    ALTER TABLE leads_lead ADD COLUMN lat DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'lng') THEN
    ALTER TABLE leads_lead ADD COLUMN lng DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'created_at') THEN
    ALTER TABLE leads_lead ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'updated_at') THEN
    ALTER TABLE leads_lead ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'extra') THEN
    ALTER TABLE leads_lead ADD COLUMN extra JSONB DEFAULT '{}'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'assigned_to_id') THEN
    ALTER TABLE leads_lead ADD COLUMN assigned_to_id INTEGER NULL;
  END IF;
END $$;
