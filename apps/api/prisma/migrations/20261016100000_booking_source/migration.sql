-- Where a booking came from, for the dashboard Reservations list (Milestone 24, B01).
-- DIRECT = created by staff in the dashboard; WEBSITE = created through the public booking flow
-- (the WordPress plugin or any other website using the public API).
-- NULL = unknown: bookings created before this column existed, and bookings created inside Clock
-- PMS and hydrated into MUST. Only the one certain case is backfilled: a booking made with a
-- public guest session is a website booking.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "source" VARCHAR(20);

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_source_check";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_source_check" CHECK ("source" IS NULL OR "source" IN ('DIRECT', 'WEBSITE'));

UPDATE "bookings" SET "source" = 'WEBSITE' WHERE "source" IS NULL AND "guest_session_id" IS NOT NULL;
