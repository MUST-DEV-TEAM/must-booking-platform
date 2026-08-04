-- Milestone 11 kickoff: schema.prisma had drifted from the applied migration
-- history (unrelated to this milestone) — the `room_type_images` table and
-- `is_auto_provisioned` columns on `users`/`tenant_memberships` were real,
-- applied, actively-used database objects (both accessed via raw SQL, which
-- bypasses Prisma Client's type-checking, so the gap went unnoticed) that had
-- been dropped from schema.prisma without a corresponding migration. This
-- migration is a no-op against the real database — it only re-syncs naming
-- conventions and adds a handful of indexes schema.prisma already declared
-- but were never created — the actual schema.prisma restoration is a
-- separate, non-migration code change. See PR description for details.

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "availability_block_room_types" DROP CONSTRAINT "availability_block_room_types_block_fkey";

-- DropForeignKey
ALTER TABLE "availability_block_room_types" DROP CONSTRAINT "availability_block_room_types_room_type_fkey";

-- DropForeignKey
ALTER TABLE "availability_block_rooms" DROP CONSTRAINT "availability_block_rooms_block_fkey";

-- DropForeignKey
ALTER TABLE "availability_block_rooms" DROP CONSTRAINT "availability_block_rooms_room_fkey";

-- DropForeignKey
ALTER TABLE "availability_blocks" DROP CONSTRAINT "availability_blocks_property_fkey";

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_tenant_guest_fkey";

-- DropForeignKey
ALTER TABLE "guests" DROP CONSTRAINT "guests_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "integration_operations" DROP CONSTRAINT "integration_operations_tenant_property_fkey";

-- DropForeignKey
ALTER TABLE "payment_provider_sessions" DROP CONSTRAINT "payment_provider_sessions_booking_fkey";

-- DropForeignKey
ALTER TABLE "payment_provider_sessions" DROP CONSTRAINT "payment_provider_sessions_property_fkey";

-- DropForeignKey
ALTER TABLE "property_staff_capability_overrides" DROP CONSTRAINT "property_staff_capability_overrides_assignment_fkey";

-- DropForeignKey
ALTER TABLE "property_staff_capability_overrides" DROP CONSTRAINT "property_staff_capability_overrides_capability_fkey";

-- DropForeignKey
ALTER TABLE "room_type_images" DROP CONSTRAINT "room_type_images_tenant_id_property_id_room_type_id_fkey";

-- DropIndex
DROP INDEX "audit_logs_actor_user_id_created_at_idx";

-- DropIndex
DROP INDEX "audit_logs_tenant_id_created_at_idx";

-- DropIndex
DROP INDEX "guests_tenant_id_created_at_idx";

-- DropIndex
DROP INDEX "integration_operations_tenant_property_created_at_idx";

-- DropIndex
DROP INDEX "notifications_tenant_property_created_at_idx";

-- DropIndex
DROP INDEX "organizations_plan_id_idx";

-- AlterTable
ALTER TABLE "guests" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "integration_operations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "organizations" ALTER COLUMN "plan_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "rate_rules" ALTER COLUMN "weekdays" SET DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[];

-- CreateIndex (schema.prisma already declared these; never actually created)
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "bookings_tenant_id_property_id_room_id_starts_on_ends_on_idx" ON "bookings"("tenant_id", "property_id", "room_id", "starts_on", "ends_on");

-- CreateIndex
CREATE INDEX "guests_tenant_id_created_at_idx" ON "guests"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_operations_tenant_id_property_id_created_at_idx" ON "integration_operations"("tenant_id", "property_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_property_id_created_at_idx" ON "notifications"("tenant_id", "property_id", "created_at");

-- CreateIndex
CREATE INDEX "property_staff_capability_overrides_tenant_id_property_id_u_idx" ON "property_staff_capability_overrides"("tenant_id", "property_id", "user_id");

-- CreateIndex
CREATE INDEX "room_price_overrides_tenant_id_property_id_room_id_idx" ON "room_price_overrides"("tenant_id", "property_id", "room_id");

-- RenameForeignKey
ALTER TABLE "amenities" RENAME CONSTRAINT "amenities_property_fkey" TO "amenities_tenant_id_property_id_fkey";

-- RenameForeignKey
ALTER TABLE "bookings" RENAME CONSTRAINT "bookings_property_fkey" TO "bookings_tenant_id_property_id_fkey";

-- RenameForeignKey
ALTER TABLE "bookings" RENAME CONSTRAINT "bookings_rate_plan_fkey" TO "bookings_tenant_id_property_id_rate_plan_id_fkey";

-- RenameForeignKey
ALTER TABLE "bookings" RENAME CONSTRAINT "bookings_room_fkey" TO "bookings_tenant_id_property_id_room_id_fkey";

-- RenameForeignKey
ALTER TABLE "bookings" RENAME CONSTRAINT "bookings_room_type_fkey" TO "bookings_tenant_id_property_id_room_type_id_fkey";

-- RenameForeignKey
ALTER TABLE "inventory_units" RENAME CONSTRAINT "inventory_units_room_type_fkey" TO "inventory_units_tenant_id_property_id_room_type_id_fkey";

-- RenameForeignKey
ALTER TABLE "notifications" RENAME CONSTRAINT "notifications_tenant_property_fkey" TO "notifications_tenant_id_property_id_fkey";

-- RenameForeignKey
ALTER TABLE "payments" RENAME CONSTRAINT "payments_booking_fkey" TO "payments_tenant_id_property_id_booking_id_fkey";

-- RenameForeignKey
ALTER TABLE "payments" RENAME CONSTRAINT "payments_property_fkey" TO "payments_tenant_id_property_id_fkey";

-- RenameForeignKey
ALTER TABLE "rate_plans" RENAME CONSTRAINT "rate_plans_property_fkey" TO "rate_plans_tenant_id_property_id_fkey";

-- RenameForeignKey
ALTER TABLE "rate_rules" RENAME CONSTRAINT "rate_rules_rate_plan_fkey" TO "rate_rules_tenant_id_property_id_rate_plan_id_fkey";

-- RenameForeignKey
ALTER TABLE "rate_rules" RENAME CONSTRAINT "rate_rules_room_type_fkey" TO "rate_rules_tenant_id_property_id_room_type_id_fkey";

-- RenameForeignKey
ALTER TABLE "room_availability" RENAME CONSTRAINT "room_availability_property_fkey" TO "room_availability_tenant_id_property_id_fkey";

-- RenameForeignKey
ALTER TABLE "room_availability" RENAME CONSTRAINT "room_availability_room_fkey" TO "room_availability_tenant_id_property_id_room_id_fkey";

-- RenameForeignKey
ALTER TABLE "room_price_overrides" RENAME CONSTRAINT "room_price_overrides_property_fkey" TO "room_price_overrides_tenant_id_property_id_fkey";

-- RenameForeignKey
ALTER TABLE "room_price_overrides" RENAME CONSTRAINT "room_price_overrides_rate_plan_fkey" TO "room_price_overrides_tenant_id_property_id_rate_plan_id_fkey";

-- RenameForeignKey
ALTER TABLE "room_price_overrides" RENAME CONSTRAINT "room_price_overrides_room_fkey" TO "room_price_overrides_tenant_id_property_id_room_id_fkey";

-- RenameForeignKey
ALTER TABLE "room_type_amenities" RENAME CONSTRAINT "room_type_amenities_amenity_fkey" TO "room_type_amenities_tenant_id_property_id_amenity_id_fkey";

-- RenameForeignKey
ALTER TABLE "room_type_amenities" RENAME CONSTRAINT "room_type_amenities_room_type_fkey" TO "room_type_amenities_tenant_id_property_id_room_type_id_fkey";

-- RenameForeignKey
ALTER TABLE "room_types" RENAME CONSTRAINT "room_types_property_fkey" TO "room_types_tenant_id_property_id_fkey";

-- RenameForeignKey
ALTER TABLE "rooms" RENAME CONSTRAINT "rooms_room_type_fkey" TO "rooms_tenant_id_property_id_room_type_id_fkey";

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_sessions" ADD CONSTRAINT "payment_provider_sessions_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_sessions" ADD CONSTRAINT "payment_provider_sessions_tenant_id_property_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "property_id", "booking_id") REFERENCES "bookings"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_amenities" ADD CONSTRAINT "room_type_amenities_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "amenities_tenant_property_id_key" RENAME TO "amenities_tenant_id_property_id_id_key";

-- RenameIndex
ALTER INDEX "amenities_tenant_property_idx" RENAME TO "amenities_tenant_id_property_id_idx";

-- RenameIndex
ALTER INDEX "amenities_tenant_property_name_key" RENAME TO "amenities_tenant_id_property_id_name_key";

-- RenameIndex
ALTER INDEX "availability_block_room_types_tenant_property_room_type_idx" RENAME TO "availability_block_room_types_tenant_id_property_id_room_ty_idx";

-- RenameIndex
ALTER INDEX "availability_block_rooms_tenant_property_room_idx" RENAME TO "availability_block_rooms_tenant_id_property_id_room_id_idx";

-- RenameIndex
ALTER INDEX "availability_blocks_tenant_property_dates_idx" RENAME TO "availability_blocks_tenant_id_property_id_starts_on_ends_on_idx";

-- RenameIndex
ALTER INDEX "availability_blocks_tenant_property_id_key" RENAME TO "availability_blocks_tenant_id_property_id_id_key";

-- RenameIndex
ALTER INDEX "bookings_tenant_property_external_reference_key" RENAME TO "bookings_tenant_id_property_id_external_reference_key";

-- RenameIndex
ALTER INDEX "bookings_tenant_property_guest_idx" RENAME TO "bookings_tenant_id_property_id_guest_id_idx";

-- RenameIndex
ALTER INDEX "bookings_tenant_property_id_key" RENAME TO "bookings_tenant_id_property_id_id_key";

-- RenameIndex
ALTER INDEX "bookings_tenant_property_room_type_stay_idx" RENAME TO "bookings_tenant_id_property_id_room_type_id_starts_on_ends__idx";

-- RenameIndex
ALTER INDEX "bookings_tenant_property_status_idx" RENAME TO "bookings_tenant_id_property_id_status_idx";

-- RenameIndex
ALTER INDEX "integration_operations_tenant_idempotency_key_key" RENAME TO "integration_operations_tenant_id_idempotency_key_key";

-- RenameIndex
ALTER INDEX "inventory_units_tenant_property_room_type_date_idx" RENAME TO "inventory_units_tenant_id_property_id_room_type_id_stays_on_idx";

-- RenameIndex
ALTER INDEX "notifications_tenant_property_read_at_idx" RENAME TO "notifications_tenant_id_property_id_read_at_idx";

-- RenameIndex
ALTER INDEX "payment_provider_sessions_booking_idx" RENAME TO "payment_provider_sessions_tenant_id_property_id_booking_id_idx";

-- RenameIndex
ALTER INDEX "payment_provider_sessions_booking_provider_unique" RENAME TO "payment_provider_sessions_tenant_id_property_id_booking_id__key";

-- RenameIndex
ALTER INDEX "payment_provider_sessions_external_unique" RENAME TO "payment_provider_sessions_tenant_id_provider_external_payme_key";

-- RenameIndex
ALTER INDEX "payments_tenant_external_payment_id_key" RENAME TO "payments_tenant_id_external_payment_id_key";

-- RenameIndex
ALTER INDEX "payments_tenant_property_booking_created_at_idx" RENAME TO "payments_tenant_id_property_id_booking_id_created_at_idx";

-- RenameIndex
ALTER INDEX "property_staff_capability_overrides_tenant_id_property_id_user_" RENAME TO "property_staff_capability_overrides_tenant_id_property_id_u_key";

-- RenameIndex
ALTER INDEX "rate_plans_tenant_property_id_key" RENAME TO "rate_plans_tenant_id_property_id_id_key";

-- RenameIndex
ALTER INDEX "rate_plans_tenant_property_idx" RENAME TO "rate_plans_tenant_id_property_id_idx";

-- RenameIndex
ALTER INDEX "rate_plans_tenant_property_name_key" RENAME TO "rate_plans_tenant_id_property_id_name_key";

-- RenameIndex
ALTER INDEX "rate_rules_tenant_property_id_key" RENAME TO "rate_rules_tenant_id_property_id_id_key";

-- RenameIndex
ALTER INDEX "rate_rules_tenant_property_rate_plan_idx" RENAME TO "rate_rules_tenant_id_property_id_rate_plan_id_idx";

-- RenameIndex
ALTER INDEX "rate_rules_tenant_property_room_type_dates_idx" RENAME TO "rate_rules_tenant_id_property_id_room_type_id_starts_on_end_idx";

-- RenameIndex
ALTER INDEX "room_types_tenant_property_id_key" RENAME TO "room_types_tenant_id_property_id_id_key";

-- RenameIndex
ALTER INDEX "room_types_tenant_property_idx" RENAME TO "room_types_tenant_id_property_id_idx";

-- RenameIndex
ALTER INDEX "room_types_tenant_property_name_key" RENAME TO "room_types_tenant_id_property_id_name_key";

-- RenameIndex
ALTER INDEX "rooms_tenant_property_id_key" RENAME TO "rooms_tenant_id_property_id_id_key";

-- RenameIndex
ALTER INDEX "rooms_tenant_property_name_key" RENAME TO "rooms_tenant_id_property_id_name_key";

-- RenameIndex
ALTER INDEX "rooms_tenant_property_room_type_idx" RENAME TO "rooms_tenant_id_property_id_room_type_id_idx";
