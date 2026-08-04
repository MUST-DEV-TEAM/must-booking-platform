-- Milestone 11, Task 11 (source brief section 20/21/27/29): webhook gateway
-- foundation. `webhook_public_id` is the random, unguessable id used in the
-- public webhook callback URL (never the internal `id`). `provider_events`
-- stores every inbound notification durably before the 2xx response, for
-- deduplication by (connection_id, event_id).

ALTER TABLE "integration_connections"
  ADD COLUMN "webhook_public_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "integration_connections"
  ADD CONSTRAINT "integration_connections_webhook_public_id_key" UNIQUE ("webhook_public_id");

-- The public webhook endpoint doesn't know which tenant a request belongs to
-- until it looks the connection up by webhook_public_id — this read-only
-- carve-out (same established pattern as the platform-admin dashboard reads)
-- lets that one lookup happen before app.tenant_id can be set. Application
-- code narrows it to a single row via WHERE webhook_public_id = $1.
DROP POLICY IF EXISTS "integration_connections_webhook_gateway_read" ON "integration_connections";
CREATE POLICY "integration_connections_webhook_gateway_read" ON "integration_connections"
  FOR SELECT
  USING (
    "tenant_id" = "app_current_tenant_id"()
    OR current_setting('app.role', true) = 'webhook_gateway'
  );

-- The same lookup also needs to resolve which property a connection is
-- enabled on (property_integration_connections), before app.tenant_id is set.
DROP POLICY IF EXISTS "property_integration_connections_webhook_gateway_read" ON "property_integration_connections";
CREATE POLICY "property_integration_connections_webhook_gateway_read" ON "property_integration_connections"
  FOR SELECT
  USING (
    "tenant_id" = "app_current_tenant_id"()
    OR current_setting('app.role', true) = 'webhook_gateway'
  );

CREATE TYPE "ProviderEventStatus" AS ENUM ('RECEIVED', 'QUEUED', 'HYDRATED', 'IGNORED', 'FAILED');

CREATE TABLE "provider_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "event_id" VARCHAR(200) NOT NULL,
    "event_type" VARCHAR(200) NOT NULL,
    "object_id" VARCHAR(200),
    "payload_hash" VARCHAR(64) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "status" "ProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_events_property_fkey"
      FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_events_connection_fkey"
      FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "integration_connections"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_events_unique" UNIQUE ("connection_id", "event_id")
);

CREATE INDEX "provider_events_tenant_id_property_id_status_idx"
  ON "provider_events"("tenant_id", "property_id", "status");

ALTER TABLE "provider_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "provider_events_tenant_isolation" ON "provider_events";
CREATE POLICY "provider_events_tenant_isolation" ON "provider_events"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
