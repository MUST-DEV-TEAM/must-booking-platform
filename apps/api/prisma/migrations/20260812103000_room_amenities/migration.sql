CREATE TABLE IF NOT EXISTS "room_amenities" (
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "room_id" UUID NOT NULL,
  "amenity_id" UUID NOT NULL,
  CONSTRAINT "room_amenities_pkey" PRIMARY KEY ("tenant_id", "property_id", "room_id", "amenity_id"),
  CONSTRAINT "room_amenities_tenant_id_property_id_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_amenities_tenant_id_property_id_room_id_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "room_id") REFERENCES "rooms"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_amenities_tenant_id_property_id_amenity_id_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "amenity_id") REFERENCES "amenities"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "room_amenities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_amenities" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "room_amenities_tenant_property_isolation" ON "room_amenities";
CREATE POLICY "room_amenities_tenant_property_isolation" ON "room_amenities"
  USING (tenant_id = app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id = app_current_property_id()))
  WITH CHECK (tenant_id = app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id = app_current_property_id()));
