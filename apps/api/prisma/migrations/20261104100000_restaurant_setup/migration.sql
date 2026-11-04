-- Restaurant first-time setup: a "setup finished" mark, booking rules, a simple deposit rule and
-- opening hours (services). Additive and re-runnable.

ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "description" VARCHAR(1000);
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "setup_completed_at" TIMESTAMPTZ(6);
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "advance_booking_days" INTEGER NOT NULL DEFAULT 60
  CHECK ("advance_booking_days" BETWEEN 1 AND 365);
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "max_online_party_size" INTEGER NOT NULL DEFAULT 8
  CHECK ("max_online_party_size" BETWEEN 1 AND 100);
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "hold_minutes" INTEGER NOT NULL DEFAULT 10
  CHECK ("hold_minutes" BETWEEN 5 AND 60);
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "last_booking_minutes_before_close" INTEGER NOT NULL DEFAULT 60
  CHECK ("last_booking_minutes_before_close" BETWEEN 0 AND 240);
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "dining_minutes" INTEGER NOT NULL DEFAULT 90
  CHECK ("dining_minutes" BETWEEN 30 AND 480);
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "deposit_mode" VARCHAR(10) NOT NULL DEFAULT 'none'
  CHECK ("deposit_mode" IN ('none', 'percent', 'fixed'));
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "deposit_value" NUMERIC(12, 2) NOT NULL DEFAULT 0
  CHECK ("deposit_value" >= 0);
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "deposit_min_party" INTEGER NOT NULL DEFAULT 1
  CHECK ("deposit_min_party" >= 1);
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "free_cancel_hours" INTEGER NOT NULL DEFAULT 24
  CHECK ("free_cancel_hours" BETWEEN 0 AND 720);

-- A percentage deposit can never be more than the whole booking.
ALTER TABLE "venues" DROP CONSTRAINT IF EXISTS "venues_deposit_percent_check";
ALTER TABLE "venues" ADD CONSTRAINT "venues_deposit_percent_check"
  CHECK ("deposit_mode" <> 'percent' OR "deposit_value" <= 100);

-- Opening hours: a service (lunch, dinner, ...) is open on some weekdays (1 = Monday ... 7 = Sunday)
-- between two times of the same day, with bookable slots every `slot_minutes`.
CREATE TABLE IF NOT EXISTS "venue_services" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "venue_id" UUID NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "days" SMALLINT[] NOT NULL,
  "opens_at" TIME NOT NULL,
  "closes_at" TIME NOT NULL,
  "slot_minutes" INTEGER NOT NULL DEFAULT 30,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venue_services_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venue_services_hours_check" CHECK ("closes_at" > "opens_at"),
  CONSTRAINT "venue_services_days_check" CHECK (cardinality("days") BETWEEN 1 AND 7),
  CONSTRAINT "venue_services_slot_check" CHECK ("slot_minutes" IN (10, 15, 20, 30, 45, 60)),
  CONSTRAINT "venue_services_tenant_venue_id_key" UNIQUE ("tenant_id", "venue_id", "id"),
  CONSTRAINT "venue_services_tenant_venue_name_key" UNIQUE ("tenant_id", "venue_id", "name"),
  CONSTRAINT "venue_services_venue_fkey"
    FOREIGN KEY ("tenant_id", "venue_id") REFERENCES "venues"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "venue_services_tenant_venue_idx" ON "venue_services"("tenant_id", "venue_id");

ALTER TABLE "venue_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "venue_services" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "venue_services_tenant_isolation" ON "venue_services";
CREATE POLICY "venue_services_tenant_isolation" ON "venue_services"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
