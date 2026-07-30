-- Milestone 4, Task 9: rate-plan cancellation policy and booking policy snapshot.
ALTER TABLE "rate_plans"
  ADD COLUMN IF NOT EXISTS "free_cancellation_until_hours" INTEGER;

DO $$
BEGIN
  ALTER TABLE "rate_plans"
    ADD CONSTRAINT "rate_plans_free_cancellation_until_hours_check"
    CHECK ("free_cancellation_until_hours" IS NULL OR "free_cancellation_until_hours" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "cancellation_is_free" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "cancellation_free_until_hours" INTEGER,
  ADD COLUMN IF NOT EXISTS "cancellation_cutoff_at" TIMESTAMPTZ(6);
