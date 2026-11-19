-- Settings redesign, Profile (S2d): the registered business address, when it differs from the hotel's.
-- Additive; the default "same as the hotel address" keeps today's meaning for every hotel.
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS registered_same_as_hotel boolean NOT NULL DEFAULT true;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS registered_street varchar(200);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS registered_city varchar(100);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS registered_postal_code varchar(20);
