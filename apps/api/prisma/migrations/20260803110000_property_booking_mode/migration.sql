-- Milestone 10, Task 1: every property uses one booking model at a time.
-- Existing and future properties default to the current pooled room-type behavior.
DO $$
BEGIN
  CREATE TYPE "PropertyBookingMode" AS ENUM (
    'ROOM_TYPE_ONLY',
    'INDIVIDUAL_ROOM_ONLY',
    'MIXED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "booking_mode" "PropertyBookingMode";

UPDATE "properties"
SET "booking_mode" = 'ROOM_TYPE_ONLY'
WHERE "booking_mode" IS NULL;

ALTER TABLE "properties"
  ALTER COLUMN "booking_mode" SET DEFAULT 'ROOM_TYPE_ONLY',
  ALTER COLUMN "booking_mode" SET NOT NULL;
