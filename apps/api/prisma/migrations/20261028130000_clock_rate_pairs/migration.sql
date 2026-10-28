-- Display-only reference rates. No price or booking data is stored here.
CREATE TABLE IF NOT EXISTS "clock_rate_pairs" (
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "promo_rate_id" TEXT NOT NULL,
  "compare_rate_id" TEXT NOT NULL,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clock_rate_pairs_pkey" PRIMARY KEY ("tenant_id", "property_id", "promo_rate_id"),
  CONSTRAINT "clock_rate_pairs_distinct" CHECK ("promo_rate_id" <> "compare_rate_id"),
  CONSTRAINT "clock_rate_pairs_property_fkey" FOREIGN KEY ("tenant_id", "property_id")
    REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "clock_rate_pairs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clock_rate_pairs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clock_rate_pairs_tenant_isolation" ON "clock_rate_pairs";
CREATE POLICY "clock_rate_pairs_tenant_isolation" ON "clock_rate_pairs"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
