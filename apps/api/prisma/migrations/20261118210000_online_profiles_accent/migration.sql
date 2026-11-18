-- Online profiles and accent colour (settings redesign S3b). Additive; nothing reads them yet.
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS online_profiles jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS accent_colour varchar(7) CHECK (accent_colour IS NULL OR accent_colour ~ '^#[0-9a-f]{6}$');
