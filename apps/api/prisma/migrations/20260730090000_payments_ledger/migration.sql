-- Milestone 5, Task 2: immutable tenant-, property-, and booking-scoped guest-payment ledger.
DO $$
BEGIN
  CREATE TYPE "PaymentKind" AS ENUM ('CHARGE', 'REFUND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "kind" "PaymentKind" NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "external_payment_id" VARCHAR(320) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "amount" NUMERIC(12, 2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_tenant_external_payment_id_key"
    UNIQUE ("tenant_id", "external_payment_id"),
  CONSTRAINT "payments_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id")
    REFERENCES "properties" ("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payments_booking_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "booking_id")
    REFERENCES "bookings" ("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payments_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS "payments_tenant_property_booking_created_at_idx"
  ON "payments" ("tenant_id", "property_id", "booking_id", "created_at");

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_tenant_property_read" ON "payments";
CREATE POLICY "payments_tenant_property_read" ON "payments"
  FOR SELECT
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );

DROP POLICY IF EXISTS "payments_tenant_property_insert" ON "payments";
CREATE POLICY "payments_tenant_property_insert" ON "payments"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
