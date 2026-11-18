-- Additive hotel location fields (settings redesign S2b). No behaviour change.
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS address_line_2 varchar(200);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS city varchar(100);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS region varchar(100);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS postal_code varchar(20);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS directions varchar(300);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS nearest_airport_code varchar(3);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS nearest_airport_km double precision CHECK (nearest_airport_km IS NULL OR nearest_airport_km BETWEEN 0 AND 500);
