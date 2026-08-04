-- Milestone 11, Task 1 (ADR-0026): tenant-owned integration connections.
-- One IntegrationConnection = one set of tenant-supplied, encrypted
-- credentials for one provider (Stripe, PokPay, or Clock PMS). Properties opt
-- in via PropertyIntegrationConnection: many PAYMENT connections may be
-- active on a property at once (guest picks at checkout), but at most one PMS
-- connection may be active at a time — enforced below by a partial unique
-- index, not just application code, since a room's availability can only
-- have one authoritative source.

CREATE TYPE "IntegrationConnectionKind" AS ENUM ('PAYMENT', 'PMS');
CREATE TYPE "IntegrationProvider" AS ENUM ('STRIPE', 'POKPAY', 'CLOCK_PMS');
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'FAILED');

CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "IntegrationConnectionKind" NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "encrypted_credentials" TEXT NOT NULL,
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "last_tested_at" TIMESTAMPTZ(6),
    "last_test_result" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_connections_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "integration_connections_tenant_id_id_key" UNIQUE ("tenant_id", "id")
);

CREATE TABLE "property_integration_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "kind" "IntegrationConnectionKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_integration_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "property_integration_connections_property_fkey"
      FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "property_integration_connections_connection_fkey"
      FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "integration_connections"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "property_integration_connections_tenant_id_property_id_conn_key"
      UNIQUE ("tenant_id", "property_id", "connection_id")
);

CREATE INDEX "integration_connections_tenant_id_kind_idx" ON "integration_connections"("tenant_id", "kind");
CREATE INDEX "property_integration_connections_tenant_id_property_id_idx" ON "property_integration_connections"("tenant_id", "property_id");
CREATE INDEX "property_integration_connections_tenant_id_connection_id_idx" ON "property_integration_connections"("tenant_id", "connection_id");

-- At most one *active* PMS connection per property (payment connections have no such limit).
CREATE UNIQUE INDEX "property_integration_connections_one_active_pms_per_property"
  ON "property_integration_connections" ("tenant_id", "property_id")
  WHERE "kind" = 'PMS' AND "enabled" = true;

ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "integration_connections_tenant_isolation" ON "integration_connections";
CREATE POLICY "integration_connections_tenant_isolation" ON "integration_connections"
  USING ("tenant_id" = "app_current_tenant_id"())
  WITH CHECK ("tenant_id" = "app_current_tenant_id"());

ALTER TABLE "property_integration_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_integration_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "property_integration_connections_tenant_isolation" ON "property_integration_connections";
CREATE POLICY "property_integration_connections_tenant_isolation" ON "property_integration_connections"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
