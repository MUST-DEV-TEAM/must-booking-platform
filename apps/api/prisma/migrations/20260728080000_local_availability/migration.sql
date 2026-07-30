-- Milestone 3, Task 8: local, per-room-type inventory for each sellable night.
CREATE TABLE IF NOT EXISTS "inventory_units" (
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "room_type_id" UUID NOT NULL,
  "stays_on" DATE NOT NULL,
  "available_units" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("tenant_id", "property_id", "room_type_id", "stays_on"),
  CONSTRAINT "inventory_units_room_type_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "room_type_id")
    REFERENCES "room_types" ("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_units_available_units_check" CHECK ("available_units" >= 0)
);

CREATE INDEX IF NOT EXISTS "inventory_units_tenant_property_room_type_date_idx"
  ON "inventory_units" ("tenant_id", "property_id", "room_type_id", "stays_on");

ALTER TABLE "inventory_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_units" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inventory_units_tenant_property_isolation" ON "inventory_units";
CREATE POLICY "inventory_units_tenant_property_isolation" ON "inventory_units"
  USING (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  );
