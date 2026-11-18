-- Guest contact fields (settings redesign S3a). Additive; defaults keep today's behaviour.
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS whatsapp_same_as_phone boolean NOT NULL DEFAULT true;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS whatsapp_number varchar(20);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS after_hours_phone varchar(20);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS reception_open_24h boolean NOT NULL DEFAULT true;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS reception_from varchar(5);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS reception_to varchar(5);
