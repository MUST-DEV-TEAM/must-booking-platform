-- Milestone 11, Task 12 (source brief section 26): every result Clock/a
-- webhook returns that MUST cannot confidently classify lands here rather
-- than being silently treated as success.

CREATE TYPE "ManualReviewCategory" AS ENUM (
  'UNKNOWN_RESULT', 'DUPLICATE', 'MISSING_MAPPING', 'SIMULTANEOUS_CHANGE',
  'PAYMENT_BOOKING_MISMATCH', 'UNKNOWN_STATUS', 'SCHEMA_MISMATCH'
);
CREATE TYPE "ManualReviewStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "manual_review_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "connection_id" UUID,
    "category" "ManualReviewCategory" NOT NULL,
    "reference_type" VARCHAR(50) NOT NULL,
    "reference_id" VARCHAR(200),
    "message" VARCHAR(1000) NOT NULL,
    "context" JSONB,
    "status" "ManualReviewStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_review_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "manual_review_items_property_fkey"
      FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "manual_review_items_connection_fkey"
      FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "integration_connections"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "manual_review_items_tenant_id_property_id_status_idx"
  ON "manual_review_items"("tenant_id", "property_id", "status");

ALTER TABLE "manual_review_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manual_review_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manual_review_items_tenant_isolation" ON "manual_review_items";
CREATE POLICY "manual_review_items_tenant_isolation" ON "manual_review_items"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
