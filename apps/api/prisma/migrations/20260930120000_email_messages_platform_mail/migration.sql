-- Milestone 22, Task 6: account-level emails (verification, welcome, password reset) belong to a
-- user, not to a hotel account, so they have no tenant. They are logged with tenant_id NULL:
--   * invisible to every tenant (the tenant policy never matches a NULL tenant),
--   * readable by the platform admin (existing platform_admin read policy),
--   * written only under a dedicated 'platform_mail' role, and only for NULL-tenant rows.
-- Duplicate protection for these rows is a partial unique index, since UNIQUE(tenant_id, key)
-- treats NULL tenants as distinct.

ALTER TABLE "email_messages" ALTER COLUMN "tenant_id" DROP NOT NULL;

CREATE UNIQUE INDEX "email_messages_platform_idempotency_key"
  ON "email_messages"("idempotency_key") WHERE "tenant_id" IS NULL;

DROP POLICY IF EXISTS "email_messages_platform_mail" ON "email_messages";
CREATE POLICY "email_messages_platform_mail" ON "email_messages"
  FOR ALL
  USING (current_setting('app.role', true) = 'platform_mail' AND "tenant_id" IS NULL)
  WITH CHECK (current_setting('app.role', true) = 'platform_mail' AND "tenant_id" IS NULL);
