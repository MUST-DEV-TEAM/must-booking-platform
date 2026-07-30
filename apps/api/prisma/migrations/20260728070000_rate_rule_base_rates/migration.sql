-- Milestone 3, Task 6 / ADR-0012: a null/null date pair is a per-room-type base rate.
ALTER TABLE "rate_rules" DROP CONSTRAINT IF EXISTS "rate_rules_dates_check";
ALTER TABLE "rate_rules" ALTER COLUMN "starts_on" DROP NOT NULL;
ALTER TABLE "rate_rules" ALTER COLUMN "ends_on" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rate_rules_dates_check'
  ) THEN
    ALTER TABLE "rate_rules"
      ADD CONSTRAINT "rate_rules_dates_check"
      CHECK (
        ("starts_on" IS NULL AND "ends_on" IS NULL)
        OR ("starts_on" IS NOT NULL AND "ends_on" IS NOT NULL AND "ends_on" >= "starts_on")
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "rate_rules_one_base_per_room_type_idx"
  ON "rate_rules" ("tenant_id", "property_id", "rate_plan_id", "room_type_id")
  WHERE "starts_on" IS NULL;
