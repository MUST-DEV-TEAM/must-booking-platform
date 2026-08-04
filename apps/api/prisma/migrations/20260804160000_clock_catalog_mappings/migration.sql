-- Milestone 11, Task 7 (source brief section 13/14): Clock catalog entities
-- are staged here as PROPOSED, never auto-applied to room_types/rooms.

CREATE TYPE "ClockCatalogEntityType" AS ENUM ('ROOM_TYPE', 'ROOM');
CREATE TYPE "ClockSyncStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'REJECTED');

CREATE TABLE "clock_catalog_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "entity_type" "ClockCatalogEntityType" NOT NULL,
    "local_entity_id" UUID,
    "external_entity_id" TEXT NOT NULL,
    "external_parent_id" TEXT,
    "external_name" VARCHAR(200) NOT NULL,
    "sync_status" "ClockSyncStatus" NOT NULL DEFAULT 'PROPOSED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clock_catalog_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clock_catalog_mappings_property_fkey"
      FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clock_catalog_mappings_connection_fkey"
      FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "integration_connections"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clock_catalog_mappings_unique" UNIQUE ("tenant_id", "connection_id", "entity_type", "external_entity_id")
);

CREATE INDEX "clock_catalog_mappings_tenant_id_property_id_sync_status_idx"
  ON "clock_catalog_mappings"("tenant_id", "property_id", "sync_status");

ALTER TABLE "clock_catalog_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clock_catalog_mappings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clock_catalog_mappings_tenant_isolation" ON "clock_catalog_mappings";
CREATE POLICY "clock_catalog_mappings_tenant_isolation" ON "clock_catalog_mappings"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
