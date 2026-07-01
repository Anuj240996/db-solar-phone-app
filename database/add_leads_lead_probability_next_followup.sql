-- Add probability and next_followup to leads_lead if missing (e.g. table created by Node script)
-- Run: psql -d db_solar -f backend/database/add_leads_lead_probability_next_followup.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'probability') THEN
    ALTER TABLE leads_lead ADD COLUMN probability INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'next_followup') THEN
    ALTER TABLE leads_lead ADD COLUMN next_followup TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;
