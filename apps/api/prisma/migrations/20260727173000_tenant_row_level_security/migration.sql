-- Milestone 1, Task 2: deny-by-default row-level security for tenancy tables.
-- The application sets these transaction-local values through TenantDatabaseService.
CREATE OR REPLACE FUNCTION "app_current_tenant_id"()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION "app_current_property_id"()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.property_id', true), '')::UUID;
$$;

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "properties" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "capabilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capabilities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "property_role_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_role_templates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "property_role_template_capabilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_role_template_capabilities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "property_staff_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_staff_assignments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizations_tenant_isolation" ON "organizations";
CREATE POLICY "organizations_tenant_isolation" ON "organizations"
  USING ("id" = "app_current_tenant_id"())
  WITH CHECK ("id" = "app_current_tenant_id"());

DROP POLICY IF EXISTS "users_tenant_read_isolation" ON "users";
CREATE POLICY "users_tenant_read_isolation" ON "users"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "tenant_memberships"
      WHERE "tenant_memberships"."tenant_id" = "app_current_tenant_id"()
        AND "tenant_memberships"."user_id" = "users"."id"
    )
  );

DROP POLICY IF EXISTS "users_tenant_update_isolation" ON "users";
CREATE POLICY "users_tenant_update_isolation" ON "users"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM "tenant_memberships"
      WHERE "tenant_memberships"."tenant_id" = "app_current_tenant_id"()
        AND "tenant_memberships"."user_id" = "users"."id"
    )
  );

DROP POLICY IF EXISTS "users_tenant_delete_isolation" ON "users";
CREATE POLICY "users_tenant_delete_isolation" ON "users"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM "tenant_memberships"
      WHERE "tenant_memberships"."tenant_id" = "app_current_tenant_id"()
        AND "tenant_memberships"."user_id" = "users"."id"
    )
  );

DROP POLICY IF EXISTS "users_deny_insert" ON "users";
CREATE POLICY "users_deny_insert" ON "users"
  FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "properties_tenant_isolation" ON "properties";
CREATE POLICY "properties_tenant_isolation" ON "properties"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "id" = "app_current_property_id"())
  );

DROP POLICY IF EXISTS "tenant_memberships_tenant_isolation" ON "tenant_memberships";
CREATE POLICY "tenant_memberships_tenant_isolation" ON "tenant_memberships"
  USING ("tenant_id" = "app_current_tenant_id"())
  WITH CHECK ("tenant_id" = "app_current_tenant_id"());

DROP POLICY IF EXISTS "capabilities_tenant_isolation" ON "capabilities";
CREATE POLICY "capabilities_tenant_isolation" ON "capabilities"
  USING ("tenant_id" = "app_current_tenant_id"())
  WITH CHECK ("tenant_id" = "app_current_tenant_id"());

DROP POLICY IF EXISTS "property_role_templates_tenant_isolation" ON "property_role_templates";
CREATE POLICY "property_role_templates_tenant_isolation" ON "property_role_templates"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );

DROP POLICY IF EXISTS "property_role_template_capabilities_tenant_isolation" ON "property_role_template_capabilities";
CREATE POLICY "property_role_template_capabilities_tenant_isolation" ON "property_role_template_capabilities"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );

DROP POLICY IF EXISTS "property_staff_assignments_tenant_isolation" ON "property_staff_assignments";
CREATE POLICY "property_staff_assignments_tenant_isolation" ON "property_staff_assignments"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
