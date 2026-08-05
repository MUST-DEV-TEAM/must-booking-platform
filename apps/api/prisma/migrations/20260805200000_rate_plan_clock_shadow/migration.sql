-- Walk-in booking redesign (sub-project 3): Clock-connected properties
-- price live from Clock and no longer have staff pick a rate_plan, but
-- bookings.rate_plan_id stays NOT NULL (it also carries the cancellation
-- policy). A "shadow" rate_plan is auto-created per confirmed Clock
-- ROOM_TYPE mapping to satisfy both without any staff-visible rate plan.
ALTER TABLE "rate_plans"
  ADD COLUMN "clock_shadow_room_type_id" UUID NULL;

CREATE UNIQUE INDEX "rate_plans_clock_shadow_room_type_id_key"
  ON "rate_plans" ("tenant_id", "property_id", "clock_shadow_room_type_id")
  WHERE "clock_shadow_room_type_id" IS NOT NULL;
