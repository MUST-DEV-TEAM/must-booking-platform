-- Milestone 38, task 4 (database review item 13, part of item 11).
--
-- 1. Two indexes identical to their table's primary key.
-- 2. bookings_tenant_property_room_stay_idx: partial copy of
--    bookings_tenant_id_property_id_room_id_starts_on_ends_on_idx, never used on live.
-- 3. Fifteen plain indexes whose columns are a left prefix of a unique index on the same
--    table (neither partial nor an expression index): the unique index serves the same
--    lookups and foreign keys. List regenerated from pg_index on 2026-11-13.
-- 4. The two trigger functions do not need EXECUTE for PUBLIC: Postgres checks that
--    privilege when a trigger is created, not when it fires.
--
-- Idempotent: every statement uses IF EXISTS, and REVOKE of a missing grant is a no-op.
-- The tables are small, so a plain DROP INDEX inside Prisma's transaction is fine.
--
-- Rollback (run as the database owner):
--   CREATE INDEX IF NOT EXISTS inventory_units_tenant_id_property_id_room_type_id_stays_on_idx ON public.inventory_units USING btree (tenant_id, property_id, room_type_id, stays_on);
--   CREATE INDEX IF NOT EXISTS room_availability_tenant_id_property_id_room_id_stays_on_idx ON public.room_availability USING btree (tenant_id, property_id, room_id, stays_on);
--   CREATE INDEX IF NOT EXISTS bookings_tenant_property_room_stay_idx ON public.bookings USING btree (tenant_id, property_id, room_id, starts_on, ends_on) WHERE (room_id IS NOT NULL);
--   CREATE INDEX IF NOT EXISTS amenities_tenant_id_property_id_idx ON public.amenities USING btree (tenant_id, property_id);
--   CREATE INDEX IF NOT EXISTS cancellation_policies_tenant_property_idx ON public.cancellation_policies USING btree (tenant_id, property_id);
--   CREATE INDEX IF NOT EXISTS capabilities_tenant_id_idx ON public.capabilities USING btree (tenant_id);
--   CREATE INDEX IF NOT EXISTS clock_guest_mappings_tenant_id_property_id_idx ON public.clock_guest_mappings USING btree (tenant_id, property_id);
--   CREATE INDEX IF NOT EXISTS clock_website_hidden_rates_tenant_id_property_id_idx ON public.clock_website_hidden_rates USING btree (tenant_id, property_id);
--   CREATE INDEX IF NOT EXISTS properties_tenant_id_idx ON public.properties USING btree (tenant_id);
--   CREATE INDEX IF NOT EXISTS property_integration_connections_tenant_id_property_id_idx ON public.property_integration_connections USING btree (tenant_id, property_id);
--   CREATE INDEX IF NOT EXISTS property_role_template_capabilities_tenant_id_property_id_idx ON public.property_role_template_capabilities USING btree (tenant_id, property_id);
--   CREATE INDEX IF NOT EXISTS property_role_templates_tenant_id_property_id_idx ON public.property_role_templates USING btree (tenant_id, property_id);
--   CREATE INDEX IF NOT EXISTS property_staff_capability_overrides_tenant_id_property_id_u_idx ON public.property_staff_capability_overrides USING btree (tenant_id, property_id, user_id);
--   CREATE INDEX IF NOT EXISTS rate_plans_tenant_id_property_id_idx ON public.rate_plans USING btree (tenant_id, property_id);
--   CREATE INDEX IF NOT EXISTS room_types_tenant_id_property_id_idx ON public.room_types USING btree (tenant_id, property_id);
--   CREATE INDEX IF NOT EXISTS venue_areas_tenant_venue_idx ON public.venue_areas USING btree (tenant_id, venue_id);
--   CREATE INDEX IF NOT EXISTS venue_services_tenant_venue_idx ON public.venue_services USING btree (tenant_id, venue_id);
--   CREATE INDEX IF NOT EXISTS venues_tenant_id_idx ON public.venues USING btree (tenant_id);
--   GRANT EXECUTE ON FUNCTION public.auth_assert_platform_user_is_exclusive(), public.auth_assert_tenant_membership_is_exclusive() TO PUBLIC;

DROP INDEX IF EXISTS "inventory_units_tenant_id_property_id_room_type_id_stays_on_idx";
DROP INDEX IF EXISTS "room_availability_tenant_id_property_id_room_id_stays_on_idx";
DROP INDEX IF EXISTS "bookings_tenant_property_room_stay_idx";

DROP INDEX IF EXISTS "amenities_tenant_id_property_id_idx";
DROP INDEX IF EXISTS "cancellation_policies_tenant_property_idx";
DROP INDEX IF EXISTS "capabilities_tenant_id_idx";
DROP INDEX IF EXISTS "clock_guest_mappings_tenant_id_property_id_idx";
DROP INDEX IF EXISTS "clock_website_hidden_rates_tenant_id_property_id_idx";
DROP INDEX IF EXISTS "properties_tenant_id_idx";
DROP INDEX IF EXISTS "property_integration_connections_tenant_id_property_id_idx";
DROP INDEX IF EXISTS "property_role_template_capabilities_tenant_id_property_id_idx";
DROP INDEX IF EXISTS "property_role_templates_tenant_id_property_id_idx";
DROP INDEX IF EXISTS "property_staff_capability_overrides_tenant_id_property_id_u_idx";
DROP INDEX IF EXISTS "rate_plans_tenant_id_property_id_idx";
DROP INDEX IF EXISTS "room_types_tenant_id_property_id_idx";
DROP INDEX IF EXISTS "venue_areas_tenant_venue_idx";
DROP INDEX IF EXISTS "venue_services_tenant_venue_idx";
DROP INDEX IF EXISTS "venues_tenant_id_idx";

REVOKE EXECUTE ON FUNCTION "auth_assert_platform_user_is_exclusive"(), "auth_assert_tenant_membership_is_exclusive"() FROM PUBLIC;
