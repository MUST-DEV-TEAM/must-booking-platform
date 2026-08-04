-- 20260804114000_repair_schema_drift dropped
-- room_type_images_tenant_id_property_id_room_type_id_fkey (its
-- ON DELETE RESTRICT protection against deleting a room type that still has
-- photos) because RoomTypeImage is deliberately modeled in schema.prisma
-- without a Prisma-level relation (matching this schema's established
-- pattern for join/attachment tables like AvailabilityBlockRoomType, whose
-- FKs are also hand-maintained in migration SQL, not Prisma's relation DSL) —
-- so the earlier diff had no way to know this FK should be kept. Restoring it.
ALTER TABLE "room_type_images"
  ADD CONSTRAINT "room_type_images_tenant_id_property_id_room_type_id_fkey"
  FOREIGN KEY ("tenant_id", "property_id", "room_type_id")
  REFERENCES "room_types"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
