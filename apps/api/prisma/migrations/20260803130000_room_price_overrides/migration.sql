-- Milestone 10, Task 3: flat per-room prices that override a room type's rate.
CREATE TABLE IF NOT EXISTS "room_price_overrides" (
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "rate_plan_id" UUID NOT NULL,
  "room_id" UUID NOT NULL,
  "amount" NUMERIC(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "room_price_overrides_pkey" PRIMARY KEY ("tenant_id", "property_id", "rate_plan_id", "room_id"),
  CONSTRAINT "room_price_overrides_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_price_overrides_rate_plan_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "rate_plan_id") REFERENCES "rate_plans"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_price_overrides_room_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "room_id") REFERENCES "rooms"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_price_overrides_amount_check" CHECK ("amount" >= 0)
);

ALTER TABLE "room_price_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_price_overrides" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "room_price_overrides_tenant_isolation" ON "room_price_overrides";
CREATE POLICY "room_price_overrides_tenant_isolation" ON "room_price_overrides"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
