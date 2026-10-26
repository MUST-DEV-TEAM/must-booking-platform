-- B2a: reservation-scoped contact overrides; the tenant-wide guest directory is unchanged.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_contact jsonb,
 ADD COLUMN IF NOT EXISTS estimated_arrival_time varchar(5);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_guest_contact_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_guest_contact_check CHECK (
 guest_contact IS NULL OR (jsonb_typeof(guest_contact)='object' AND guest_contact ?& ARRAY['firstName','lastName','email','phone'])
);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_estimated_arrival_time_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_estimated_arrival_time_check
 CHECK(estimated_arrival_time IS NULL OR estimated_arrival_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
-- Existing booking RLS, composite identity and version constraints apply unchanged.
-- Rollback after reverting B2a code and exporting edited contact/arrival data:
-- ALTER TABLE bookings DROP COLUMN guest_contact, DROP COLUMN estimated_arrival_time;
