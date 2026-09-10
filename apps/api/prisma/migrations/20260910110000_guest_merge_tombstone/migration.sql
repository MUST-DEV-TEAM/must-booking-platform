-- Milestone 21, Task 5: retain merged guest records as auditable tombstones.
ALTER TABLE "guests"
  ADD COLUMN IF NOT EXISTS "merged_into_guest_id" UUID;

CREATE INDEX IF NOT EXISTS "guests_tenant_merged_into_idx"
  ON "guests" ("tenant_id", "merged_into_guest_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guests_tenant_merged_into_fkey'
      AND conrelid = 'guests'::regclass
  ) THEN
    ALTER TABLE "guests"
      ADD CONSTRAINT "guests_tenant_merged_into_fkey"
      FOREIGN KEY ("tenant_id", "merged_into_guest_id")
      REFERENCES "guests" ("tenant_id", "id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guests_merged_into_not_self'
      AND conrelid = 'guests'::regclass
  ) THEN
    ALTER TABLE "guests"
      ADD CONSTRAINT "guests_merged_into_not_self"
      CHECK (
        "merged_into_guest_id" IS NULL
        OR "merged_into_guest_id" <> "id"
      );
  END IF;
END $$;
