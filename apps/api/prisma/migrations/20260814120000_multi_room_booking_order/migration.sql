-- Milestone 12 Task 14: a multi-room order is represented by a shared, tenant/property-scoped
-- parent reference on otherwise independent booking rows.  Each child's external_reference is
-- the provider-safe child reference (for example, must-order-X-room1); the shared order_reference
-- keeps the group traceable locally without changing legacy single-room bookings.
-- Rollback plan: after all multi-room application code has been removed, drop the index and these
-- four nullable columns. Existing single-room bookings remain untouched.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "order_reference" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "order_room_number" INTEGER,
  ADD COLUMN IF NOT EXISTS "room_guest_first_name" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "room_guest_last_name" VARCHAR(100);

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_order_room_number_positive";

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_order_room_number_positive"
  CHECK ("order_room_number" IS NULL OR "order_room_number" > 0);

CREATE INDEX IF NOT EXISTS "bookings_tenant_property_order_reference_room_idx"
  ON "bookings" ("tenant_id", "property_id", "order_reference", "order_room_number");
