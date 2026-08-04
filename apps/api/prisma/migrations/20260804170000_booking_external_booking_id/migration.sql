-- Milestone 11 Task 10: Clock's real booking id is distinct from our local
-- `bookings.id` (unlike LocalPmsProvider, which reuses its own uuid as the
-- "external booking id"). Nullable so existing Local rows are unaffected.
ALTER TABLE "bookings" ADD COLUMN "external_booking_id" VARCHAR(64);

CREATE INDEX "bookings_tenant_id_property_id_external_booking_id_idx"
  ON "bookings" ("tenant_id", "property_id", "external_booking_id");
