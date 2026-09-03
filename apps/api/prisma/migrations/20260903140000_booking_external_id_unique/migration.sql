-- Clock webhook event hydration (Milestone 12 Tasks 16/17): a shadow booking
-- mirrored in from a Clock-originated event must be idempotent under
-- re-delivery/retry, so (tenant, property, external_booking_id) needs to be
-- a real unique key, not just an index. Postgres treats NULL as distinct
-- from any other value, so this does not constrain the many existing rows
-- with no external_booking_id.
DROP INDEX IF EXISTS "bookings_tenant_id_property_id_external_booking_id_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_tenant_id_property_id_external_booking_id_key"
  ON "bookings"("tenant_id", "property_id", "external_booking_id");
