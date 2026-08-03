-- Milestone 10, Task 7: one manual availability-block action can target a
-- whole property, selected room types, and selected individual rooms together.
CREATE TABLE IF NOT EXISTS "availability_blocks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "starts_on" DATE NOT NULL,
  "ends_on" DATE NOT NULL,
  "blocks_all" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "availability_blocks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "availability_blocks_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "availability_blocks_tenant_property_id_key" UNIQUE ("tenant_id", "property_id", "id"),
  CONSTRAINT "availability_blocks_dates_check" CHECK ("ends_on" > "starts_on")
);

CREATE TABLE IF NOT EXISTS "availability_block_room_types" (
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "block_id" UUID NOT NULL,
  "room_type_id" UUID NOT NULL,
  CONSTRAINT "availability_block_room_types_pkey" PRIMARY KEY ("tenant_id", "property_id", "block_id", "room_type_id"),
  CONSTRAINT "availability_block_room_types_block_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "block_id") REFERENCES "availability_blocks"("tenant_id", "property_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "availability_block_room_types_room_type_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "room_type_id") REFERENCES "room_types"("tenant_id", "property_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "availability_block_rooms" (
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "block_id" UUID NOT NULL,
  "room_id" UUID NOT NULL,
  CONSTRAINT "availability_block_rooms_pkey" PRIMARY KEY ("tenant_id", "property_id", "block_id", "room_id"),
  CONSTRAINT "availability_block_rooms_block_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "block_id") REFERENCES "availability_blocks"("tenant_id", "property_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "availability_block_rooms_room_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "room_id") REFERENCES "rooms"("tenant_id", "property_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "availability_blocks_tenant_property_dates_idx"
  ON "availability_blocks"("tenant_id", "property_id", "starts_on", "ends_on");
CREATE INDEX IF NOT EXISTS "availability_block_room_types_tenant_property_room_type_idx"
  ON "availability_block_room_types"("tenant_id", "property_id", "room_type_id");
CREATE INDEX IF NOT EXISTS "availability_block_rooms_tenant_property_room_idx"
  ON "availability_block_rooms"("tenant_id", "property_id", "room_id");

ALTER TABLE "availability_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "availability_blocks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "availability_block_room_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "availability_block_room_types" FORCE ROW LEVEL SECURITY;
ALTER TABLE "availability_block_rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "availability_block_rooms" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "availability_blocks_tenant_isolation" ON "availability_blocks";
CREATE POLICY "availability_blocks_tenant_isolation" ON "availability_blocks"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );

DROP POLICY IF EXISTS "availability_block_room_types_tenant_isolation" ON "availability_block_room_types";
CREATE POLICY "availability_block_room_types_tenant_isolation" ON "availability_block_room_types"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );

DROP POLICY IF EXISTS "availability_block_rooms_tenant_isolation" ON "availability_block_rooms";
CREATE POLICY "availability_block_rooms_tenant_isolation" ON "availability_block_rooms"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
