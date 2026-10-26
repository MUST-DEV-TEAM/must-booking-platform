-- Which reservations each staff member has already looked at, so the dashboard can mark new ones
-- (a dot in the list and a count on the Bookings item) and clear them once they are opened.
CREATE TABLE IF NOT EXISTS "booking_seen" (
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_seen_pkey" PRIMARY KEY ("tenant_id", "user_id", "booking_id"),
  CONSTRAINT "booking_seen_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "booking_seen_property_user_idx"
  ON "booking_seen"("tenant_id", "property_id", "user_id");

ALTER TABLE "booking_seen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_seen" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "booking_seen_isolation" ON "booking_seen";
CREATE POLICY "booking_seen_isolation" ON "booking_seen"
  USING ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()))
  WITH CHECK ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()));
