-- Task 50: historical bookings did not retain a party size.  The default keeps
-- those rows truthful to the only value previously available to email templates.
-- Rollback plan: after code no longer reads it, `DROP COLUMN guest_count` is safe.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "guest_count" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_guest_count_positive";

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_guest_count_positive" CHECK ("guest_count" > 0);
