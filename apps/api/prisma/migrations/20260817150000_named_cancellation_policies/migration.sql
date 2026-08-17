CREATE TABLE "cancellation_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "free_cancellation_days_before_arrival" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cancellation_policies_property_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cancellation_policies_tenant_property_id_key" UNIQUE ("tenant_id", "property_id", "id"),
  CONSTRAINT "cancellation_policies_tenant_property_name_key" UNIQUE ("tenant_id", "property_id", "name")
);
CREATE INDEX "cancellation_policies_tenant_property_idx" ON "cancellation_policies" ("tenant_id", "property_id");

ALTER TABLE "rate_plans" ADD COLUMN "cancellation_policy_id" UUID;
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_cancellation_policy_fkey"
  FOREIGN KEY ("tenant_id", "property_id", "cancellation_policy_id")
  REFERENCES "cancellation_policies"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "rate_plans_cancellation_policy_idx" ON "rate_plans" ("tenant_id", "property_id", "cancellation_policy_id");

ALTER TABLE "cancellation_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cancellation_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "cancellation_policies_tenant_isolation" ON "cancellation_policies"
  USING ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()))
  WITH CHECK ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()));
