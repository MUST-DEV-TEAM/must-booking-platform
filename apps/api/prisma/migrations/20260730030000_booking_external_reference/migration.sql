-- Milestone 4, Task 4: local provider lookup by MUST external reference.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "external_reference" VARCHAR(200) NOT NULL DEFAULT gen_random_uuid()::text;

ALTER TABLE "bookings"
  ALTER COLUMN "external_reference" DROP DEFAULT;

DO $$
BEGIN
  ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_tenant_property_external_reference_key"
      UNIQUE ("tenant_id", "property_id", "external_reference");
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;
