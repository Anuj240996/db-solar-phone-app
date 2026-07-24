-- Add rooftop area and unit to leads_lead (Get Quote form).
-- Run: psql -d db_solar -f backend/database/add_leads_lead_rooftop_area.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'rooftop_area') THEN
    ALTER TABLE leads_lead ADD COLUMN rooftop_area DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'rooftop_area_unit') THEN
    ALTER TABLE leads_lead ADD COLUMN rooftop_area_unit TEXT DEFAULT 'sq_m';
  END IF;
END $$;
