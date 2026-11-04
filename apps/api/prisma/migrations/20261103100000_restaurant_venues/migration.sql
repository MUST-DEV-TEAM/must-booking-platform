-- Restaurant venues, stage 1: a venue (restaurant) with areas, tables, table combinations and
-- venue staff. A venue belongs to a tenant and may optionally link to a hotel property.
-- Additive and re-runnable. Plans gain a dining switch and a venue limit, both off by default.

ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dining_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "max_venues" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "venues" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID,
  "name" VARCHAR(200) NOT NULL,
  "slug" VARCHAR(100) NOT NULL,
  "timezone" VARCHAR(100),
  "currency" CHAR(3),
  "address" VARCHAR(500),
  "phone" VARCHAR(100),
  "contact_email" VARCHAR(320),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venues_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "venues_tenant_id_slug_key" UNIQUE ("tenant_id", "slug"),
  CONSTRAINT "venues_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "venues_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "venues_tenant_id_idx" ON "venues"("tenant_id");

CREATE TABLE IF NOT EXISTS "venue_areas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "venue_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "map_width" INTEGER NOT NULL DEFAULT 1000 CHECK ("map_width" BETWEEN 400 AND 3000),
  "map_height" INTEGER NOT NULL DEFAULT 700 CHECK ("map_height" BETWEEN 400 AND 3000),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venue_areas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venue_areas_tenant_venue_id_key" UNIQUE ("tenant_id", "venue_id", "id"),
  CONSTRAINT "venue_areas_tenant_venue_name_key" UNIQUE ("tenant_id", "venue_id", "name"),
  CONSTRAINT "venue_areas_venue_fkey"
    FOREIGN KEY ("tenant_id", "venue_id") REFERENCES "venues"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "venue_areas_tenant_venue_idx" ON "venue_areas"("tenant_id", "venue_id");

CREATE TABLE IF NOT EXISTS "venue_tables" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "venue_id" UUID NOT NULL,
  "area_id" UUID NOT NULL,
  "label" VARCHAR(30) NOT NULL,
  "min_seats" INTEGER NOT NULL,
  "max_seats" INTEGER NOT NULL,
  "map_x" INTEGER NOT NULL DEFAULT 0 CHECK ("map_x" >= 0),
  "map_y" INTEGER NOT NULL DEFAULT 0 CHECK ("map_y" >= 0),
  "map_width" INTEGER NOT NULL DEFAULT 80 CHECK ("map_width" > 0),
  "map_height" INTEGER NOT NULL DEFAULT 80 CHECK ("map_height" > 0),
  "shape" VARCHAR(10) NOT NULL DEFAULT 'square' CHECK ("shape" IN ('square', 'round', 'rect')),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venue_tables_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venue_tables_seats_check" CHECK ("min_seats" >= 1 AND "max_seats" >= "min_seats"),
  CONSTRAINT "venue_tables_tenant_venue_id_key" UNIQUE ("tenant_id", "venue_id", "id"),
  CONSTRAINT "venue_tables_tenant_area_label_key" UNIQUE ("tenant_id", "area_id", "label"),
  CONSTRAINT "venue_tables_area_fkey"
    FOREIGN KEY ("tenant_id", "venue_id", "area_id") REFERENCES "venue_areas"("tenant_id", "venue_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "venue_tables_tenant_area_idx" ON "venue_tables"("tenant_id", "venue_id", "area_id");

-- One row per unordered pair of tables that can be pushed together; "a" is always the smaller id.
CREATE TABLE IF NOT EXISTS "venue_table_combinations" (
  "tenant_id" UUID NOT NULL,
  "venue_id" UUID NOT NULL,
  "table_a_id" UUID NOT NULL,
  "table_b_id" UUID NOT NULL,
  CONSTRAINT "venue_table_combinations_pkey" PRIMARY KEY ("tenant_id", "venue_id", "table_a_id", "table_b_id"),
  CONSTRAINT "venue_table_combinations_order_check" CHECK ("table_a_id" < "table_b_id"),
  CONSTRAINT "venue_table_combinations_a_fkey"
    FOREIGN KEY ("tenant_id", "venue_id", "table_a_id") REFERENCES "venue_tables"("tenant_id", "venue_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "venue_table_combinations_b_fkey"
    FOREIGN KEY ("tenant_id", "venue_id", "table_b_id") REFERENCES "venue_tables"("tenant_id", "venue_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Stage 1 uses two fixed roles; the table is shaped so role templates can replace them later.
CREATE TABLE IF NOT EXISTS "venue_staff_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "venue_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" VARCHAR(10) NOT NULL CHECK ("role" IN ('MANAGER', 'HOST')),
  "suspended_at" TIMESTAMPTZ(6),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venue_staff_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venue_staff_assignments_tenant_venue_user_key" UNIQUE ("tenant_id", "venue_id", "user_id"),
  CONSTRAINT "venue_staff_assignments_venue_fkey"
    FOREIGN KEY ("tenant_id", "venue_id") REFERENCES "venues"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "venue_staff_assignments_membership_fkey"
    FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "venue_staff_assignments_tenant_user_idx" ON "venue_staff_assignments"("tenant_id", "user_id");

-- Row-level security: every venue table is isolated by tenant, like the hotel tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['venues', 'venue_areas', 'venue_tables', 'venue_table_combinations', 'venue_staff_assignments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
