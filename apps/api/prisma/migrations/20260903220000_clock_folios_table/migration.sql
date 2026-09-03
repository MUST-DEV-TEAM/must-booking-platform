-- Financial-flow gap Task B (docs/CLOCK_FINANCIAL_RECONCILIATION_PLAN.md):
-- replaces the same-night single-folio-per-booking columns on bookings,
-- which couldn't tell a deposit folio from a general one — a booking
-- genuinely has both at once (CONFIRMED_IN_SANDBOX, Task 0). Visibility
-- only: no relation to payments, no write path back to Clock.
ALTER TABLE "bookings"
  DROP COLUMN IF EXISTS "clock_folio_id",
  DROP COLUMN IF EXISTS "clock_folio_balance",
  DROP COLUMN IF EXISTS "clock_folio_closed_at";

CREATE TABLE IF NOT EXISTS "clock_folios" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "clock_folio_id" VARCHAR(64) NOT NULL,
  "is_deposit" BOOLEAN NOT NULL,
  "balance" NUMERIC(12, 2),
  "closed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clock_folios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clock_folios_tenant_property_clock_folio_id_key"
    UNIQUE ("tenant_id", "property_id", "clock_folio_id"),
  CONSTRAINT "clock_folios_booking_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "booking_id")
    REFERENCES "bookings" ("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "clock_folios_tenant_property_booking_idx"
  ON "clock_folios" ("tenant_id", "property_id", "booking_id");

ALTER TABLE "clock_folios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clock_folios" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clock_folios_tenant_property_isolation" ON "clock_folios";
CREATE POLICY "clock_folios_tenant_property_isolation" ON "clock_folios"
  USING (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  );
