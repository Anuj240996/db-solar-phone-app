-- Migration: create leads_lead table for Get Quote flow
-- Run with: node run_create_leads_lead_migration.js (or psql -f create_leads_lead_table.sql)

CREATE TABLE IF NOT EXISTS leads_lead (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  property_type TEXT,
  roof_type TEXT,
  electricity_bill TEXT,
  monthly_consumption TEXT,
  sorting_address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  email TEXT,
  contact TEXT,
  phone TEXT,
  address TEXT,
  stage TEXT NOT NULL DEFAULT 'new_app',
  status TEXT,
  payment_mode TEXT,
  user_app_id BIGINT,
  assigned_to_id INTEGER,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  source TEXT,
  campaign TEXT,
  score INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  extra JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_lead_user_app_id ON leads_lead (user_app_id);
CREATE INDEX IF NOT EXISTS idx_leads_lead_stage ON leads_lead (stage);
