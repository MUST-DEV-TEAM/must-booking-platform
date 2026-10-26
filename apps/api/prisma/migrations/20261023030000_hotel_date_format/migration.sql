-- Additive hotel-wide display preference; no booking dates or account data are changed.
-- Rollback: stop callers, export preferences, then remove the column only with owner approval.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS date_format VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='properties_date_format_check' AND conrelid='properties'::regclass) THEN
ALTER TABLE properties ADD CONSTRAINT properties_date_format_check CHECK(date_format IN ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD')); END IF; END $$;
