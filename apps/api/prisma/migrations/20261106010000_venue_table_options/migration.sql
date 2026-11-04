-- Additive and replayable. Existing tables retain their booking eligibility.
ALTER TABLE venue_tables ADD COLUMN IF NOT EXISTS notes varchar(1000);
ALTER TABLE venue_tables ADD COLUMN IF NOT EXISTS features text[] NOT NULL DEFAULT '{}';
ALTER TABLE venue_tables ADD COLUMN IF NOT EXISTS online_bookable boolean NOT NULL DEFAULT true;
ALTER TABLE venue_tables ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_tables_options_check') THEN
  ALTER TABLE venue_tables ADD CONSTRAINT venue_tables_options_check CHECK (
   priority BETWEEN 0 AND 1000 AND features <@ ARRAY['window','outdoor','accessible','quiet','high_chair']::text[]
  );
 END IF;
END $$;
