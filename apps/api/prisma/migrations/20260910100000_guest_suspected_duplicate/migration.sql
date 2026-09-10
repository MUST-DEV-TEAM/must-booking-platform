-- Milestone 21, Task 3: retain an advisory phone-match candidate for staff review.
ALTER TABLE "guests"
  ADD COLUMN IF NOT EXISTS "suspected_duplicate_of_guest_id" UUID;

CREATE INDEX IF NOT EXISTS "guests_tenant_suspected_duplicate_idx"
  ON "guests" ("tenant_id", "suspected_duplicate_of_guest_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guests_tenant_suspected_duplicate_fkey'
      AND conrelid = 'guests'::regclass
  ) THEN
    ALTER TABLE "guests"
      ADD CONSTRAINT "guests_tenant_suspected_duplicate_fkey"
      FOREIGN KEY ("tenant_id", "suspected_duplicate_of_guest_id")
      REFERENCES "guests" ("tenant_id", "id")
      ON DELETE SET NULL ("suspected_duplicate_of_guest_id")
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guests_suspected_duplicate_not_self'
      AND conrelid = 'guests'::regclass
  ) THEN
    ALTER TABLE "guests"
      ADD CONSTRAINT "guests_suspected_duplicate_not_self"
      CHECK (
        "suspected_duplicate_of_guest_id" IS NULL
        OR "suspected_duplicate_of_guest_id" <> "id"
      );
  END IF;
END $$;
