CREATE TABLE IF NOT EXISTS room_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  room_id UUID NOT NULL,
  object_key TEXT,
  source_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT room_images_source_check CHECK ((object_key IS NOT NULL) <> (source_url IS NOT NULL)),
  CONSTRAINT room_images_room_fkey
    FOREIGN KEY (tenant_id, property_id, room_id)
    REFERENCES rooms (tenant_id, property_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT room_images_object_key_unique UNIQUE (tenant_id, property_id, room_id, object_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS room_images_external_url_unique_idx
  ON room_images (tenant_id, property_id, room_id, source_url)
  WHERE source_url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS room_images_single_primary_idx
  ON room_images (tenant_id, property_id, room_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS room_images_gallery_order_idx
  ON room_images (tenant_id, property_id, room_id, sort_order, created_at);

ALTER TABLE room_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_images FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_images_isolation ON room_images;
CREATE POLICY room_images_isolation ON room_images
  USING (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  );

-- Rollback after reverting the application code: drop the table and its indexes.
-- DROP TABLE IF EXISTS room_images;
