-- Additive hotel identity and legal fields (settings redesign S2a). No behaviour change.
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS chain_name varchar(120);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_type varchar(30);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS star_rating_official boolean NOT NULL DEFAULT false;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS year_opened integer CHECK (year_opened IS NULL OR year_opened BETWEEN 1800 AND 2200);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS year_renovated integer CHECK (year_renovated IS NULL OR year_renovated BETWEEN 1800 AND 2200);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS summary varchar(160);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS tourism_licence varchar(50);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS vat_registered boolean NOT NULL DEFAULT false;
