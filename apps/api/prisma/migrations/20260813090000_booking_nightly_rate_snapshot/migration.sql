-- Task 49: preserve the signed, per-night guest quote so confirmation never
-- recalculates historical pricing. NULL is retained for bookings made before
-- this additive migration, where an accurate nightly breakdown is unavailable.
-- Rollback plan: after deploying code that no longer reads this snapshot,
-- `ALTER TABLE "bookings" DROP COLUMN IF EXISTS "nightly_rates"` is safe.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "nightly_rates" JSONB;
