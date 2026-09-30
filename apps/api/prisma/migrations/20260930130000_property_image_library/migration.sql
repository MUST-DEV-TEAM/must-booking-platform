-- Property-level photo library: images are uploaded once per property and then
-- attached to any number of room types. room_type_images keeps referencing the
-- same object_key, so the library owns the stored object.
CREATE TABLE IF NOT EXISTS property_library_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  object_key TEXT NOT NULL,
  original_name VARCHAR(255),
  -- Set once the file is verified in object storage; unconfirmed rows are abandoned uploads.
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, property_id, object_key),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS property_library_images_property_created_idx
  ON property_library_images (tenant_id, property_id, created_at DESC);

ALTER TABLE property_library_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_library_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_library_images_isolation ON property_library_images;
CREATE POLICY property_library_images_isolation ON property_library_images
  USING (tenant_id = app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id = app_current_property_id()))
  WITH CHECK (tenant_id = app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id = app_current_property_id()));

-- Photos already uploaded to room types become part of the library.
INSERT INTO property_library_images (tenant_id, property_id, object_key, created_at, confirmed_at)
SELECT DISTINCT ON (tenant_id, property_id, object_key) tenant_id, property_id, object_key, created_at, created_at
FROM room_type_images
WHERE object_key IS NOT NULL
ORDER BY tenant_id, property_id, object_key, created_at
ON CONFLICT (tenant_id, property_id, object_key) DO NOTHING;
