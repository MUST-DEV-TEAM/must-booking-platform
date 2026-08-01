-- Milestone 8, Task 1: platform admins can read the small cross-tenant
-- dashboard inventory without gaining a bypass-RLS connection or write access.
-- These are SELECT policies only. Existing tenant policies continue to govern
-- every write operation.

DROP POLICY IF EXISTS "organizations_platform_admin_read" ON "organizations";
CREATE POLICY "organizations_platform_admin_read" ON "organizations"
  FOR SELECT
  USING (
    "id" = "app_current_tenant_id"()
    OR current_setting('app.role', true) = 'platform_admin'
  );

DROP POLICY IF EXISTS "users_platform_admin_read" ON "users";
CREATE POLICY "users_platform_admin_read" ON "users"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "tenant_memberships"
      WHERE "tenant_memberships"."tenant_id" = "app_current_tenant_id"()
        AND "tenant_memberships"."user_id" = "users"."id"
    )
    OR current_setting('app.role', true) = 'platform_admin'
  );

DROP POLICY IF EXISTS "tenant_memberships_platform_admin_read" ON "tenant_memberships";
CREATE POLICY "tenant_memberships_platform_admin_read" ON "tenant_memberships"
  FOR SELECT
  USING (
    "tenant_id" = "app_current_tenant_id"()
    OR current_setting('app.role', true) = 'platform_admin'
  );
