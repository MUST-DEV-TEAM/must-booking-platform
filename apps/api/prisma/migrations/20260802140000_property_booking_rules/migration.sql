-- Milestone 9, Task 2: optional, property-level booking rules.
-- NULL means the corresponding rule is not configured.

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "min_stay_nights" INTEGER,
  ADD COLUMN IF NOT EXISTS "max_stay_nights" INTEGER,
  ADD COLUMN IF NOT EXISTS "check_in_time" TEXT,
  ADD COLUMN IF NOT EXISTS "check_out_time" TEXT,
  ADD COLUMN IF NOT EXISTS "advance_booking_days" INTEGER;
