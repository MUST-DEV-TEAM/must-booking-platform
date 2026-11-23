-- Booking rules, "Booking form": a booking can now carry the company name, tax number and marketing consent that a hotel
-- chooses to ask for (the arrival time already has estimated_arrival_time; the address is on the guest).
-- Marketing consent is recorded per booking with the time it was given; it is never assumed (default false).
--
-- Additive only. Rollback (nothing else refers to these columns):
--   ALTER TABLE bookings DROP COLUMN IF EXISTS company_name, DROP COLUMN IF EXISTS tax_number,
--     DROP COLUMN IF EXISTS marketing_consent, DROP COLUMN IF EXISTS marketing_consent_at;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS company_name varchar(160);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tax_number varchar(40);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz;
