-- Staff can turn an individual Clock rate off for the hotel's website. Rates are on by default: a rate has a row
-- here only while it is switched off, so a new rate in Clock is sold online as soon as it is published there.
-- Staff booking screens are not affected; only the guest-facing website honours this list.

CREATE TABLE "clock_website_hidden_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "external_rate_id" TEXT NOT NULL,
    "hidden_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clock_website_hidden_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clock_website_hidden_rates_property_fkey"
      FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clock_website_hidden_rates_rate_unique" UNIQUE ("tenant_id", "property_id", "external_rate_id")
);

CREATE INDEX "clock_website_hidden_rates_tenant_id_property_id_idx"
  ON "clock_website_hidden_rates"("tenant_id", "property_id");

ALTER TABLE "clock_website_hidden_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clock_website_hidden_rates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clock_website_hidden_rates_tenant_isolation" ON "clock_website_hidden_rates";
CREATE POLICY "clock_website_hidden_rates_tenant_isolation" ON "clock_website_hidden_rates"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
