-- Milestone 24, platform admin console (Phase 1): separate platform accounts, capability roles,
-- sessions, invitations, append-only platform audit log and idempotency records.
--
-- Platform-global tables carry no tenant_id. They are reachable only when the API sets
-- app.role = 'platform_console' (TenantDatabaseService.withPlatformConsoleTransaction), which only
-- server code does after PlatformAccessGuard has authenticated a platform session.

CREATE OR REPLACE FUNCTION "platform_forbid_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is append-only.', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

CREATE TABLE IF NOT EXISTS "platform_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "key" VARCHAR(60) NOT NULL UNIQUE,
  "name" VARCHAR(100) NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "is_built_in" BOOLEAN NOT NULL DEFAULT false,
  "capabilities" TEXT[] NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO "platform_roles" ("key", "name", "description", "is_built_in", "capabilities") VALUES
  ('super_admin', 'Super admin', 'Everything, including team management, billing and dangerous actions.', true,
    ARRAY['platform.hotels.view','platform.hotels.create','platform.hotels.lifecycle','platform.hotels.dangerous',
      'platform.connections.view','platform.integrations.manage','platform.billing.view','platform.billing.manage',
      'platform.support.view_as','platform.support.act_as','platform.support.approve',
      'platform.team.view','platform.team.manage','platform.audit.view','platform.audit.export']),
  ('operations', 'Operations / support', 'Hotels, lifecycle, integrations and support access.', true,
    ARRAY['platform.hotels.view','platform.hotels.create','platform.hotels.lifecycle','platform.connections.view',
      'platform.integrations.manage','platform.support.view_as','platform.support.act_as','platform.support.approve',
      'platform.audit.view']),
  ('finance', 'Finance', 'Plans, billing and invoices; read-only elsewhere.', true,
    ARRAY['platform.hotels.view','platform.connections.view','platform.billing.view','platform.billing.manage']),
  ('auditor', 'Read-only auditor', 'Reads hotels, connections, billing, team and the audit log; changes nothing.', true,
    ARRAY['platform.hotels.view','platform.connections.view','platform.billing.view','platform.team.view','platform.audit.view'])
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "platform_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "email" VARCHAR(320) NOT NULL,
  "first_name" VARCHAR(100),
  "last_name" VARCHAR(100),
  "password_hash" TEXT,
  "role_id" UUID NOT NULL REFERENCES "platform_roles"("id") ON DELETE RESTRICT,
  "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('INVITED','ACTIVE','SUSPENDED')),
  "last_login_at" TIMESTAMPTZ,
  "created_by" UUID,
  "migrated_from_user_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_accounts_email_lower" ON "platform_accounts" (lower("email"));

CREATE TABLE IF NOT EXISTS "platform_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "account_id" UUID NOT NULL REFERENCES "platform_accounts"("id") ON DELETE RESTRICT,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "revoke_reason" VARCHAR(60),
  "ip" VARCHAR(64),
  "user_agent" VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS "platform_sessions_account" ON "platform_sessions" ("account_id", "revoked_at");

CREATE TABLE IF NOT EXISTS "platform_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "account_id" UUID NOT NULL REFERENCES "platform_accounts"("id") ON DELETE RESTRICT,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "invited_by" UUID,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "accepted_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "platform_audit_log" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "actor_account_id" UUID,
  "actor_email" VARCHAR(320),
  "actor_role" VARCHAR(60),
  "action" VARCHAR(120) NOT NULL,
  "tenant_id" UUID,
  "property_id" UUID,
  "target_type" VARCHAR(100),
  "target_id" VARCHAR(320),
  "before" JSONB,
  "after" JSONB,
  "reason" TEXT,
  "result" VARCHAR(12) NOT NULL CHECK ("result" IN ('succeeded','failed','denied')),
  "ip" VARCHAR(64),
  "user_agent" VARCHAR(300),
  "request_id" VARCHAR(128),
  "support_session_id" UUID,
  "details" JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS "platform_audit_log_created" ON "platform_audit_log" ("created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "platform_audit_log_tenant" ON "platform_audit_log" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "platform_audit_log_actor" ON "platform_audit_log" ("actor_account_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "platform_audit_log_action" ON "platform_audit_log" ("action" text_pattern_ops);

DROP TRIGGER IF EXISTS "platform_audit_log_no_update" ON "platform_audit_log";
CREATE TRIGGER "platform_audit_log_no_update" BEFORE UPDATE OR DELETE ON "platform_audit_log"
  FOR EACH ROW EXECUTE FUNCTION "platform_forbid_mutation"();
DROP TRIGGER IF EXISTS "platform_audit_log_no_truncate" ON "platform_audit_log";
CREATE TRIGGER "platform_audit_log_no_truncate" BEFORE TRUNCATE ON "platform_audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "platform_forbid_mutation"();

CREATE TABLE IF NOT EXISTS "platform_idempotency_keys" (
  "account_id" UUID NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "route" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "status_code" INTEGER NOT NULL,
  "response" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("account_id", "key")
);

-- Platform-global tables: closed to everything except the platform console role.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_roles','platform_accounts','platform_sessions','platform_invitations',
    'platform_audit_log','platform_idempotency_keys']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "platform_console_only" ON %I', t);
    EXECUTE format('CREATE POLICY "platform_console_only" ON %I USING (current_setting(''app.role'', true) = ''platform_console'') WITH CHECK (current_setting(''app.role'', true) = ''platform_console'')', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'must_booking_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "platform_roles", "platform_accounts", "platform_sessions",
      "platform_invitations", "platform_idempotency_keys" TO must_booking_app;
    -- The audit log is append-only for the runtime role: no UPDATE, DELETE or TRUNCATE.
    REVOKE ALL ON "platform_audit_log" FROM must_booking_app;
    GRANT SELECT, INSERT ON "platform_audit_log" TO must_booking_app;
  END IF;
END $$;
