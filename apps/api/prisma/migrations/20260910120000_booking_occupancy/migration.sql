-- Milestone 21, Task 6: retain the legacy total while storing its adult/child breakdown.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "adults" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "children" INTEGER NOT NULL DEFAULT 0;

-- Preserve historical totals where the old guest_count carried more than the
-- default one adult. New writes keep all three columns in sync in application code.
UPDATE "bookings"
SET "adults" = GREATEST("guest_count", 1), "children" = 0
WHERE "adults" = 1 AND "children" = 0 AND "guest_count" > 1;

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_adults_positive";

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_adults_positive" CHECK ("adults" >= 1);

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_children_nonnegative";

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_children_nonnegative" CHECK ("children" >= 0);
