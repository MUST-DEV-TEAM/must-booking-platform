-- Milestone 4, Task 2: tenant- and property-scoped local booking records.
DO $$
BEGIN
  CREATE TYPE "BookingStatus" AS ENUM (
    'DRAFT',
    'QUOTED',
    'INVENTORY_REVALIDATING',
    'PAYMENT_PENDING',
    'PAYMENT_NOT_REQUIRED',
    'PMS_CREATION_PENDING',
    'PMS_CONFIRMATION_PENDING',
    'CONFIRMED',
    'AVAILABILITY_FAILED',
    'PAYMENT_FAILED',
    'PMS_UNKNOWN_RESULT',
    'PMS_REJECTED',
    'MANUAL_REVIEW',
    'CANCELLED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "room_type_id" UUID NOT NULL,
  "guest_id" UUID,
  "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
  "starts_on" DATE NOT NULL,
  "ends_on" DATE NOT NULL,
  "rate_plan_id" UUID NOT NULL,
  "total_amount" NUMERIC(12, 2) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bookings_tenant_property_id_key" UNIQUE ("tenant_id", "property_id", "id"),
  CONSTRAINT "bookings_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id")
    REFERENCES "properties" ("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bookings_room_type_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "room_type_id")
    REFERENCES "room_types" ("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bookings_rate_plan_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "rate_plan_id")
    REFERENCES "rate_plans" ("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bookings_stay_dates_check" CHECK ("ends_on" > "starts_on"),
  CONSTRAINT "bookings_total_amount_check" CHECK ("total_amount" >= 0),
  CONSTRAINT "bookings_version_check" CHECK ("version" > 0)
);

CREATE INDEX IF NOT EXISTS "bookings_tenant_property_status_idx"
  ON "bookings" ("tenant_id", "property_id", "status");
CREATE INDEX IF NOT EXISTS "bookings_tenant_property_room_type_stay_idx"
  ON "bookings" ("tenant_id", "property_id", "room_type_id", "starts_on", "ends_on");
CREATE INDEX IF NOT EXISTS "bookings_tenant_property_guest_idx"
  ON "bookings" ("tenant_id", "property_id", "guest_id");

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bookings_tenant_property_isolation" ON "bookings";
CREATE POLICY "bookings_tenant_property_isolation" ON "bookings"
  USING (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  );
