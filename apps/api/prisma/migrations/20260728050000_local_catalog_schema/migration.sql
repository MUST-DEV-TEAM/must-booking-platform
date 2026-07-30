-- Milestone 3, Task 2: local, PMS-independent property catalog.
CREATE TABLE IF NOT EXISTS "room_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "property_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL, "description" TEXT, "max_occupancy" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "room_types_pkey" PRIMARY KEY ("id"), CONSTRAINT "room_types_property_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_types_max_occupancy_check" CHECK ("max_occupancy" > 0), CONSTRAINT "room_types_tenant_property_id_key" UNIQUE ("tenant_id", "property_id", "id"), CONSTRAINT "room_types_tenant_property_name_key" UNIQUE ("tenant_id", "property_id", "name")
);
CREATE TABLE IF NOT EXISTS "rooms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "property_id" UUID NOT NULL, "room_type_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rooms_pkey" PRIMARY KEY ("id"), CONSTRAINT "rooms_room_type_fkey" FOREIGN KEY ("tenant_id", "property_id", "room_type_id") REFERENCES "room_types"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rooms_tenant_property_id_key" UNIQUE ("tenant_id", "property_id", "id"), CONSTRAINT "rooms_tenant_property_name_key" UNIQUE ("tenant_id", "property_id", "name")
);
CREATE TABLE IF NOT EXISTS "rate_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "property_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL, "currency" CHAR(3) NOT NULL, "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id"), CONSTRAINT "rate_plans_property_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rate_plans_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'), CONSTRAINT "rate_plans_tenant_property_id_key" UNIQUE ("tenant_id", "property_id", "id"), CONSTRAINT "rate_plans_tenant_property_name_key" UNIQUE ("tenant_id", "property_id", "name")
);
CREATE TABLE IF NOT EXISTS "rate_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "property_id" UUID NOT NULL, "rate_plan_id" UUID NOT NULL, "room_type_id" UUID NOT NULL,
  "starts_on" DATE NOT NULL, "ends_on" DATE NOT NULL, "weekdays" SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::SMALLINT[], "amount" NUMERIC(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_rules_pkey" PRIMARY KEY ("id"), CONSTRAINT "rate_rules_rate_plan_fkey" FOREIGN KEY ("tenant_id", "property_id", "rate_plan_id") REFERENCES "rate_plans"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rate_rules_room_type_fkey" FOREIGN KEY ("tenant_id", "property_id", "room_type_id") REFERENCES "room_types"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rate_rules_dates_check" CHECK ("ends_on" >= "starts_on"), CONSTRAINT "rate_rules_weekdays_check" CHECK ("weekdays" <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[] AND cardinality("weekdays") > 0), CONSTRAINT "rate_rules_amount_check" CHECK ("amount" >= 0), CONSTRAINT "rate_rules_tenant_property_id_key" UNIQUE ("tenant_id", "property_id", "id")
);
CREATE TABLE IF NOT EXISTS "amenities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "property_id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "amenities_pkey" PRIMARY KEY ("id"), CONSTRAINT "amenities_property_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "amenities_tenant_property_id_key" UNIQUE ("tenant_id", "property_id", "id"), CONSTRAINT "amenities_tenant_property_name_key" UNIQUE ("tenant_id", "property_id", "name")
);
CREATE TABLE IF NOT EXISTS "room_type_amenities" (
  "tenant_id" UUID NOT NULL, "property_id" UUID NOT NULL, "room_type_id" UUID NOT NULL, "amenity_id" UUID NOT NULL,
  CONSTRAINT "room_type_amenities_pkey" PRIMARY KEY ("tenant_id", "property_id", "room_type_id", "amenity_id"), CONSTRAINT "room_type_amenities_room_type_fkey" FOREIGN KEY ("tenant_id", "property_id", "room_type_id") REFERENCES "room_types"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_type_amenities_amenity_fkey" FOREIGN KEY ("tenant_id", "property_id", "amenity_id") REFERENCES "amenities"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "room_types_tenant_property_idx" ON "room_types"("tenant_id", "property_id");
CREATE INDEX IF NOT EXISTS "rooms_tenant_property_room_type_idx" ON "rooms"("tenant_id", "property_id", "room_type_id");
CREATE INDEX IF NOT EXISTS "rate_plans_tenant_property_idx" ON "rate_plans"("tenant_id", "property_id");
CREATE INDEX IF NOT EXISTS "rate_rules_tenant_property_rate_plan_idx" ON "rate_rules"("tenant_id", "property_id", "rate_plan_id");
CREATE INDEX IF NOT EXISTS "rate_rules_tenant_property_room_type_dates_idx" ON "rate_rules"("tenant_id", "property_id", "room_type_id", "starts_on", "ends_on");
CREATE INDEX IF NOT EXISTS "amenities_tenant_property_idx" ON "amenities"("tenant_id", "property_id");

DO $$ DECLARE table_name TEXT; BEGIN FOREACH table_name IN ARRAY ARRAY['room_types','rooms','rate_plans','rate_rules','amenities','room_type_amenities'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name); EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_property_isolation', table_name); EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id = app_current_property_id())) WITH CHECK (tenant_id = app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id = app_current_property_id()))', table_name || '_tenant_property_isolation', table_name); END LOOP; END $$;
