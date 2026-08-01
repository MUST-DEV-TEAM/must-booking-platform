-- Milestone 5, Task 10: bind public booking mutations to the guest/staff session
-- that created the booking. Existing rows receive an unguessable value and cannot
-- be changed through the anonymous guest routes after this migration.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "guest_session_id" UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE "bookings"
  ALTER COLUMN "guest_session_id" DROP DEFAULT;
