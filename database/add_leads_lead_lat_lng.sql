-- Add lat, lng to existing leads_lead table (run only if columns do not exist)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'lat'
  ) THEN
    ALTER TABLE leads_lead ADD COLUMN lat DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'lng'
  ) THEN
    ALTER TABLE leads_lead ADD COLUMN lng DOUBLE PRECISION;
  END IF;
END $$;
