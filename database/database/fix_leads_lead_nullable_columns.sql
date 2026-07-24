-- Fix leads_lead columns that may be NOT NULL without default (e.g. from Django)
-- Run: psql -d db_solar -f backend/database/fix_leads_lead_nullable_columns.sql
-- Safe to run: only sets defaults / drops NOT NULL so inserts do not fail.

DO $$
BEGIN
  -- Ensure created_at has default so INSERT can omit or use it
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'created_at') THEN
    ALTER TABLE leads_lead ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE leads_lead ALTER COLUMN created_at DROP NOT NULL;
  END IF;
  -- Ensure updated_at has default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'updated_at') THEN
    ALTER TABLE leads_lead ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE leads_lead ALTER COLUMN updated_at DROP NOT NULL;
  END IF;
  -- Ensure extra accepts empty or has default (JSONB or TEXT)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'extra') THEN
    BEGIN
      ALTER TABLE leads_lead ALTER COLUMN extra SET DEFAULT '{}'::jsonb;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- column may be JSONB; default may already exist
    END;
    ALTER TABLE leads_lead ALTER COLUMN extra DROP NOT NULL;
  END IF;
  -- assigned_to_id can be NULL (unassigned)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'assigned_to_id') THEN
    ALTER TABLE leads_lead ALTER COLUMN assigned_to_id DROP NOT NULL;
  END IF;
END $$;
