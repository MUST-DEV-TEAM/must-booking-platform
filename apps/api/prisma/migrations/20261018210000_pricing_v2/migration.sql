ALTER TABLE properties ADD COLUMN IF NOT EXISTS pricing_version INTEGER NOT NULL DEFAULT 1 CHECK(pricing_version>0);
ALTER TABLE rate_plans
 ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN IF NOT EXISTS code VARCHAR(40),
 ADD COLUMN IF NOT EXISTS lifecycle TEXT,
 ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS pricing_basis TEXT NOT NULL DEFAULT 'independent' CHECK(pricing_basis IN ('independent','derived')),
 ADD COLUMN IF NOT EXISTS base_plan_id UUID,
 ADD COLUMN IF NOT EXISTS adjustment_kind TEXT NOT NULL DEFAULT 'percentage' CHECK(adjustment_kind IN ('percentage','per_person_night')),
 ADD COLUMN IF NOT EXISTS adjustment_value NUMERIC(12,2) NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS room_type_ids UUID[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS channels TEXT[] NOT NULL DEFAULT ARRAY['website','staff'],
 ADD COLUMN IF NOT EXISTS meal_plan TEXT NOT NULL DEFAULT 'room_only' CHECK(meal_plan IN ('room_only','breakfast','half_board','full_board')),
 ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS min_stay INTEGER CHECK(min_stay>0),
 ADD COLUMN IF NOT EXISTS max_stay INTEGER CHECK(max_stay>0),
 ADD COLUMN IF NOT EXISTS min_advance INTEGER CHECK(min_advance>=0),
 ADD COLUMN IF NOT EXISTS publication_starts_on DATE,
 ADD COLUMN IF NOT EXISTS publication_ends_on DATE;
UPDATE rate_plans SET code='RP-'||upper(substr(replace(id::text,'-',''),1,12)) WHERE code IS NULL;
UPDATE rate_plans SET lifecycle=CASE WHEN is_active THEN 'Active' ELSE 'Draft' END WHERE lifecycle IS NULL;
ALTER TABLE rate_plans ALTER COLUMN code SET NOT NULL, ALTER COLUMN lifecycle SET NOT NULL, ALTER COLUMN lifecycle SET DEFAULT 'Draft';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pricing_plan_parent_scope') THEN
 ALTER TABLE rate_plans ADD CONSTRAINT pricing_plan_parent_scope FOREIGN KEY(tenant_id,property_id,base_plan_id) REFERENCES rate_plans(tenant_id,property_id,id) ON DELETE RESTRICT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pricing_plan_lifecycle') THEN
 ALTER TABLE rate_plans ADD CONSTRAINT pricing_plan_lifecycle CHECK(lifecycle IN ('Draft','Active','Archived'));
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS pricing_plan_code ON rate_plans(tenant_id,property_id,code);
CREATE UNIQUE INDEX IF NOT EXISTS pricing_plan_fallback ON rate_plans(tenant_id,property_id) WHERE is_fallback;
UPDATE rate_plans p SET is_fallback=true WHERE p.id IN (
 SELECT DISTINCT ON (tenant_id,property_id) id FROM rate_plans r WHERE is_active AND clock_shadow_room_type_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM rate_plans f WHERE f.tenant_id=r.tenant_id AND f.property_id=r.property_id AND f.is_fallback)
 ORDER BY tenant_id,property_id,created_at,id);
CREATE OR REPLACE FUNCTION pricing_plan_defaults() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  NEW.code:=COALESCE(NEW.code,'RP-'||upper(substr(replace(NEW.id::text,'-',''),1,12)));
  IF NEW.is_active AND NEW.lifecycle='Draft' THEN NEW.lifecycle:='Active'; END IF;
  IF NEW.is_active AND NEW.clock_shadow_room_type_id IS NULL AND NOT EXISTS(SELECT 1 FROM rate_plans f WHERE f.tenant_id=NEW.tenant_id AND f.property_id=NEW.property_id AND f.is_fallback) THEN NEW.is_fallback:=true; END IF;
 ELSE
  IF NEW.code<>OLD.code THEN RAISE EXCEPTION 'Rate plan code is immutable'; END IF;
  IF NEW.lifecycle<>OLD.lifecycle THEN NEW.is_active:=(NEW.lifecycle='Active');
  ELSIF NEW.is_active<>OLD.is_active THEN NEW.lifecycle:=CASE WHEN NEW.is_active THEN 'Active' ELSE 'Draft' END; END IF;
 END IF;
 IF NEW.is_fallback AND (NOT NEW.is_active OR NEW.lifecycle<>'Active') THEN RAISE EXCEPTION 'Replace fallback before deactivating it'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pricing_plan_defaults_trigger ON rate_plans;
CREATE TRIGGER pricing_plan_defaults_trigger BEFORE INSERT OR UPDATE ON rate_plans FOR EACH ROW EXECUTE FUNCTION pricing_plan_defaults();
ALTER TABLE rate_rules ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE room_price_overrides ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
CREATE TABLE IF NOT EXISTS pricing_daily_prices (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,rate_plan_id UUID NOT NULL,room_type_id UUID NOT NULL,stays_on DATE NOT NULL,
 amount NUMERIC(12,2) NOT NULL CHECK(amount>=0),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(tenant_id,property_id,rate_plan_id,room_type_id,stays_on),
 FOREIGN KEY(tenant_id,property_id,rate_plan_id) REFERENCES rate_plans(tenant_id,property_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,property_id,room_type_id) REFERENCES room_types(tenant_id,property_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS pricing_adjustments (
 id UUID NOT NULL DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,property_id UUID NOT NULL,name VARCHAR(200) NOT NULL,
 lifecycle TEXT NOT NULL DEFAULT 'Draft' CHECK(lifecycle IN ('Draft','Active','Archived')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 mode TEXT NOT NULL CHECK(mode IN ('percentage','fixed')),value NUMERIC(12,2) NOT NULL,currency CHAR(3),
 room_type_ids UUID[] NOT NULL DEFAULT '{}',rate_plan_ids UUID[] NOT NULL DEFAULT '{}',
 starts_on DATE NOT NULL,ends_on DATE,weekdays SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::smallint[],priority INTEGER NOT NULL DEFAULT 50 CHECK(priority BETWEEN 1 AND 100),
 min_stay INTEGER CHECK(min_stay>0),max_stay INTEGER CHECK(max_stay>0),min_advance INTEGER CHECK(min_advance>=0),max_advance INTEGER CHECK(max_advance>=0),
 note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,property_id,id),FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT,
 CHECK(ends_on IS NULL OR ends_on>=starts_on),CHECK(cardinality(weekdays)>0 AND weekdays<@ARRAY[1,2,3,4,5,6,7]::smallint[]),CHECK(mode='percentage' OR currency IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS pricing_charges (
 id UUID NOT NULL DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,property_id UUID NOT NULL,name VARCHAR(200) NOT NULL,
 lifecycle TEXT NOT NULL DEFAULT 'Draft' CHECK(lifecycle IN ('Draft','Active','Archived')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 basis TEXT NOT NULL CHECK(basis IN ('percentage_accommodation','percentage_subtotal','per_adult_night','per_person_night','per_stay')),
 value NUMERIC(12,2) NOT NULL CHECK(value>=0),currency CHAR(3),display TEXT NOT NULL CHECK(display IN ('included','added')),confirmed BOOLEAN NOT NULL DEFAULT false,
 room_type_ids UUID[] NOT NULL DEFAULT '{}',rate_plan_ids UUID[] NOT NULL DEFAULT '{}',channels TEXT[] NOT NULL DEFAULT ARRAY['website','staff'],
 starts_on DATE NOT NULL,ends_on DATE,note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,property_id,id),FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT,
 CHECK(ends_on IS NULL OR ends_on>=starts_on),CHECK(basis LIKE 'percentage_%' OR currency IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS pricing_operations (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,idempotency_key VARCHAR(128) NOT NULL,request_hash CHAR(64) NOT NULL,response JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,property_id,idempotency_key),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
DO $$ DECLARE tab TEXT; BEGIN
 FOREACH tab IN ARRAY ARRAY['pricing_daily_prices','pricing_adjustments','pricing_charges','pricing_operations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('DROP POLICY IF EXISTS pricing_scope ON %I',tab);
 EXECUTE format('CREATE POLICY pricing_scope ON %I USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())',tab);
 END LOOP;
END $$;
-- Additive rollback: application first; retain/export configuration and operation receipts.
-- Do not run pre-feature pricing readers while derived plans/charges/daily prices are active.
-- No issued quote or booking money is changed by this migration.
