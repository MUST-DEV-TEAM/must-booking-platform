CREATE TABLE IF NOT EXISTS room_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  storefront_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT room_categories_property_fkey
    FOREIGN KEY (tenant_id, property_id)
    REFERENCES properties (tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT room_categories_property_name_unique UNIQUE (tenant_id, property_id, name),
  CONSTRAINT room_categories_tenant_property_id_unique UNIQUE (tenant_id, property_id, id)
);

CREATE INDEX IF NOT EXISTS room_categories_order_idx
  ON room_categories (tenant_id, property_id, sort_order, name);

ALTER TABLE room_types ADD COLUMN IF NOT EXISTS category_id UUID;
ALTER TABLE room_types DROP CONSTRAINT IF EXISTS room_types_category_fkey;
ALTER TABLE room_types ADD CONSTRAINT room_types_category_fkey
  FOREIGN KEY (tenant_id, property_id, category_id)
  REFERENCES room_categories (tenant_id, property_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE room_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_categories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_categories_isolation ON room_categories;
CREATE POLICY room_categories_isolation ON room_categories
  USING (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())
  );

-- Rollback after reverting the application code:
-- ALTER TABLE room_types DROP CONSTRAINT IF EXISTS room_types_category_fkey;
-- ALTER TABLE room_types DROP COLUMN IF EXISTS category_id;
-- DROP TABLE IF EXISTS room_categories;
