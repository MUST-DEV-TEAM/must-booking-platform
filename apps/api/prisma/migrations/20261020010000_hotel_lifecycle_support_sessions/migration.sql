-- Milestone 24, platform admin console (Phase 1): hotel lifecycle, onboarding profile and
-- support sessions. Additive and re-runnable. organizations.status stays as the access flag that
-- existing code reads; a trigger keeps it consistent with the new lifecycle_state.

DO $$
BEGIN
  CREATE TYPE "OrganizationLifecycleState" AS ENUM
    ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "lifecycle_state" "OrganizationLifecycleState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "lifecycle_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "lifecycle_changed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "lifecycle_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "country" CHAR(2),
  ADD COLUMN IF NOT EXISTS "time_zone" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "currency" CHAR(3),
  ADD COLUMN IF NOT EXISTS "onboarding_mode" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "owner_invited_email" VARCHAR(320),
  ADD COLUMN IF NOT EXISTS "owner_invited_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "created_by_platform_account_id" UUID;

DO $$
BEGIN
  ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_onboarding_mode_check"
    CHECK ("onboarding_mode" IS NULL OR "onboarding_mode" IN ('CLOCK', 'MUST_SOURCE'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Existing suspended hotels become lifecycle SUSPENDED (no behaviour change).
UPDATE "organizations"
SET "lifecycle_state" = 'SUSPENDED'
WHERE "status" = 'SUSPENDED' AND "lifecycle_state" = 'ACTIVE';

CREATE OR REPLACE FUNCTION "organizations_sync_lifecycle"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- A legacy write that changed only status is mapped into the lifecycle first.
  IF TG_OP = 'UPDATE'
     AND NEW."lifecycle_state" IS NOT DISTINCT FROM OLD."lifecycle_state"
     AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NEW."status" = 'SUSPENDED' AND NEW."lifecycle_state" IN ('TRIAL', 'ACTIVE', 'PAST_DUE') THEN
      NEW."lifecycle_state" := 'SUSPENDED';
    ELSIF NEW."status" = 'ACTIVE' AND NEW."lifecycle_state" = 'SUSPENDED' THEN
      NEW."lifecycle_state" := 'ACTIVE';
    END IF;
  END IF;

  NEW."status" := CASE
    WHEN NEW."lifecycle_state" IN ('SUSPENDED', 'CANCELLED', 'ARCHIVED') THEN 'SUSPENDED'
    ELSE 'ACTIVE'
  END::"OrganizationStatus";

  IF TG_OP = 'UPDATE' AND NEW."lifecycle_state" IS DISTINCT FROM OLD."lifecycle_state" THEN
    NEW."lifecycle_changed_at" := now();
    NEW."lifecycle_version" := OLD."lifecycle_version" + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "organizations_sync_lifecycle" ON "organizations";
CREATE TRIGGER "organizations_sync_lifecycle" BEFORE INSERT OR UPDATE ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION "organizations_sync_lifecycle"();

CREATE TABLE IF NOT EXISTS "organization_lifecycle_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "from_state" "OrganizationLifecycleState",
  "to_state" "OrganizationLifecycleState" NOT NULL,
  "reason" TEXT NOT NULL,
  "actor_account_id" UUID,
  "actor_email" VARCHAR(320),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "organization_lifecycle_events_tenant"
  ON "organization_lifecycle_events" ("tenant_id", "created_at" DESC);

DROP TRIGGER IF EXISTS "organization_lifecycle_events_no_change" ON "organization_lifecycle_events";
CREATE TRIGGER "organization_lifecycle_events_no_change" BEFORE UPDATE OR DELETE ON "organization_lifecycle_events"
  FOR EACH ROW EXECUTE FUNCTION "platform_forbid_mutation"();

CREATE TABLE IF NOT EXISTS "support_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "platform_account_id" UUID NOT NULL,
  "account_email" VARCHAR(320) NOT NULL,
  "account_name" VARCHAR(200),
  "kind" VARCHAR(4) NOT NULL CHECK ("kind" IN ('VIEW', 'ACT')),
  "status" VARCHAR(20) NOT NULL
    CHECK ("status" IN ('PENDING_APPROVAL', 'ACTIVE', 'EXPIRED', 'REVOKED', 'DENIED')),
  "reason" TEXT NOT NULL,
  "token_hash" CHAR(64) UNIQUE,
  "duration_minutes" INTEGER NOT NULL CHECK ("duration_minutes" BETWEEN 5 AND 120),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "starts_at" TIMESTAMPTZ,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "approval_method" VARCHAR(10) CHECK ("approval_method" IS NULL OR "approval_method" IN ('OWNER', 'PLATFORM')),
  "approved_by" VARCHAR(320),
  "approved_at" TIMESTAMPTZ,
  "denied_at" TIMESTAMPTZ,
  "ended_at" TIMESTAMPTZ,
  "ended_by" VARCHAR(320),
  "version" INTEGER NOT NULL DEFAULT 0
);
-- One open (pending or active) session per platform user per hotel.
CREATE UNIQUE INDEX IF NOT EXISTS "support_sessions_one_open"
  ON "support_sessions" ("tenant_id", "platform_account_id")
  WHERE "status" IN ('PENDING_APPROVAL', 'ACTIVE');
CREATE INDEX IF NOT EXISTS "support_sessions_tenant" ON "support_sessions" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "support_sessions_account" ON "support_sessions" ("platform_account_id", "created_at" DESC);

-- Tenant-scoped tables: forced RLS. The platform console role may also read and write them (the
-- console sets app.tenant_id too whenever it acts on one hotel).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_lifecycle_events', 'support_sessions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_or_console" ON %I', t);
    EXECUTE format('CREATE POLICY "tenant_or_console" ON %I USING ("tenant_id" = "app_current_tenant_id"() OR current_setting(''app.role'', true) = ''platform_console'') WITH CHECK ("tenant_id" = "app_current_tenant_id"() OR current_setting(''app.role'', true) = ''platform_console'')', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'must_booking_app') THEN
    GRANT SELECT, INSERT ON "organization_lifecycle_events" TO must_booking_app;
    GRANT SELECT, INSERT, UPDATE ON "support_sessions" TO must_booking_app;
  END IF;
END $$;
