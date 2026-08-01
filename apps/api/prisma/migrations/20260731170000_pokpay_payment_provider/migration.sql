-- Milestone 5, Task 12: bind a PokPay SDK order to its local booking before
-- accepting a return/webhook. Charges and refunds remain in the append-only ledger.
ALTER TYPE "BookingPaymentMethod" ADD VALUE IF NOT EXISTS 'POKPAY';

CREATE TABLE IF NOT EXISTS "payment_provider_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "external_payment_id" VARCHAR(320) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_provider_sessions_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payment_provider_sessions_booking_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "booking_id") REFERENCES "bookings"("tenant_id", "property_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payment_provider_sessions_external_unique" UNIQUE ("tenant_id", "provider", "external_payment_id"),
  CONSTRAINT "payment_provider_sessions_booking_provider_unique" UNIQUE ("tenant_id", "property_id", "booking_id", "provider")
);

CREATE INDEX IF NOT EXISTS "payment_provider_sessions_booking_idx"
  ON "payment_provider_sessions" ("tenant_id", "property_id", "booking_id");

ALTER TABLE "payment_provider_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_provider_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_provider_sessions_tenant_isolation" ON "payment_provider_sessions";
CREATE POLICY "payment_provider_sessions_tenant_isolation" ON "payment_provider_sessions"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE OR REPLACE FUNCTION "pokpay_payment_session_candidate"(external_id TEXT)
RETURNS TABLE ("bookingId" UUID, "tenantId" UUID, "propertyId" UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT booking_id, tenant_id, property_id
  FROM payment_provider_sessions
  WHERE provider = 'pokpay' AND external_payment_id = external_id
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION "pokpay_payment_session_candidate"(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "pokpay_payment_session_candidate"(TEXT) TO must_booking_app;

CREATE OR REPLACE FUNCTION "payment_pending_pokpay_candidates"(maximum_rows INTEGER DEFAULT 100)
RETURNS TABLE ("bookingId" UUID, "tenantId" UUID, "propertyId" UUID, "externalPaymentId" TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.booking_id, s.tenant_id, s.property_id, s.external_payment_id
  FROM payment_provider_sessions s
  JOIN bookings b ON b.tenant_id = s.tenant_id AND b.property_id = s.property_id AND b.id = s.booking_id
  WHERE s.provider = 'pokpay' AND b.status = 'PAYMENT_PENDING'::"BookingStatus"
  ORDER BY b.created_at, b.id
  LIMIT GREATEST(maximum_rows, 1)
$$;
REVOKE ALL ON FUNCTION "payment_pending_pokpay_candidates"(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "payment_pending_pokpay_candidates"(INTEGER) TO must_booking_app;
