-- Milestone 8, Task 7: the platform dashboard needs the platform-admin
-- activity feed. This is a SELECT-only policy.
-- Existing tenant policies continue to govern every write operation.

DROP POLICY IF EXISTS "audit_logs_platform_admin_read" ON "audit_logs";
CREATE POLICY "audit_logs_platform_admin_read" ON "audit_logs"
  FOR SELECT
  USING (current_setting('app.role', true) = 'platform_admin');
