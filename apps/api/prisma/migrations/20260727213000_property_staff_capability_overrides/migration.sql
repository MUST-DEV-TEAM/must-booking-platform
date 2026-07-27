ALTER TYPE "TenantMembershipRole" ADD VALUE IF NOT EXISTS 'STAFF';

CREATE TABLE IF NOT EXISTS "property_staff_capability_overrides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "capability_id" UUID NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_staff_capability_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "property_staff_capability_overrides_assignment_fkey" FOREIGN KEY ("tenant_id", "property_id", "user_id") REFERENCES "property_staff_assignments"("tenant_id", "property_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "property_staff_capability_overrides_capability_fkey" FOREIGN KEY ("tenant_id", "capability_id") REFERENCES "capabilities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "property_staff_capability_overrides_tenant_id_property_id_user_id_capability_id_key" UNIQUE ("tenant_id", "property_id", "user_id", "capability_id")
);
CREATE INDEX IF NOT EXISTS "property_staff_capability_overrides_tenant_id_property_id_user_id_idx" ON "property_staff_capability_overrides"("tenant_id", "property_id", "user_id");

ALTER TABLE "property_staff_capability_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_staff_capability_overrides" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "property_staff_capability_overrides_tenant_isolation" ON "property_staff_capability_overrides";
CREATE POLICY "property_staff_capability_overrides_tenant_isolation" ON "property_staff_capability_overrides"
  USING ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()))
  WITH CHECK ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()));
