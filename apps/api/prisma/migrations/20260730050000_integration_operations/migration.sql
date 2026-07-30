CREATE TABLE IF NOT EXISTS "integration_operations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(320) NOT NULL,
  "aggregate_id" UUID,
  "external_reference" VARCHAR(320),
  "request_hash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "external_entity_id" UUID,
  "result" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_operations_attempts_check" CHECK ("attempts" > 0),
  CONSTRAINT "integration_operations_tenant_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id")
    REFERENCES "properties" ("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_operations_tenant_idempotency_key_key" UNIQUE ("tenant_id", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "integration_operations_tenant_property_created_at_idx"
  ON "integration_operations" ("tenant_id", "property_id", "created_at" DESC);

ALTER TABLE "integration_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_operations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "integration_operations_tenant_property_isolation" ON "integration_operations";
CREATE POLICY "integration_operations_tenant_property_isolation" ON "integration_operations"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
