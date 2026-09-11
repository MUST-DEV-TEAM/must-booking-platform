-- Milestone 21, Task 15: remember the Clock guest identity resolved for a
-- local guest within a property's independent Clock guest pool.
CREATE TABLE IF NOT EXISTS "clock_guest_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "external_guest_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clock_guest_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clock_guest_mappings_property_fkey"
      FOREIGN KEY ("tenant_id", "property_id")
      REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clock_guest_mappings_guest_fkey"
      FOREIGN KEY ("tenant_id", "guest_id")
      REFERENCES "guests"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clock_guest_mappings_tenant_property_guest_key"
      UNIQUE ("tenant_id", "property_id", "guest_id"),
    CONSTRAINT "clock_guest_mappings_tenant_property_external_key"
      UNIQUE ("tenant_id", "property_id", "external_guest_id")
);

CREATE INDEX IF NOT EXISTS "clock_guest_mappings_tenant_id_property_id_idx"
  ON "clock_guest_mappings" ("tenant_id", "property_id");

ALTER TABLE "clock_guest_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clock_guest_mappings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clock_guest_mappings_tenant_isolation" ON "clock_guest_mappings";
CREATE POLICY "clock_guest_mappings_tenant_isolation" ON "clock_guest_mappings"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
