-- Milestone 10, Task 2: explicit per-room, per-night availability for
-- individual-room properties. Absence of a row means the room is available.
CREATE TABLE IF NOT EXISTS "room_availability" (
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "room_id" UUID NOT NULL,
  "stays_on" DATE NOT NULL,
  "is_available" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "room_availability_pkey" PRIMARY KEY ("tenant_id", "property_id", "room_id", "stays_on"),
  CONSTRAINT "room_availability_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_availability_room_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "room_id") REFERENCES "rooms"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "room_availability_tenant_id_property_id_room_id_stays_on_idx"
  ON "room_availability"("tenant_id", "property_id", "room_id", "stays_on");

ALTER TABLE "room_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_availability" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "room_availability_tenant_isolation" ON "room_availability";
CREATE POLICY "room_availability_tenant_isolation" ON "room_availability"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
