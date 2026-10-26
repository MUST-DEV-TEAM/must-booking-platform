-- Additive capture only. Roll back application first; retain observations/nullable metadata.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reason_code TEXT CHECK(reason_code IN ('guest_request','hotel_cancellation','duplicate_payment','overbooking','service_issue','goodwill','other'));
ALTER TABLE pricing_charges ADD COLUMN IF NOT EXISTS category TEXT CHECK(category IN ('vat','tourist_tax','service','other'));
ALTER TABLE guests ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) CHECK(country_code IN ('AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'));
ALTER TABLE guests ADD COLUMN IF NOT EXISTS capture_version INTEGER NOT NULL DEFAULT 1 CHECK(capture_version>0);
CREATE OR REPLACE FUNCTION preserve_charge_category() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.category IS DISTINCT FROM OLD.category THEN RAISE EXCEPTION 'Charge category is immutable; duplicate the charge' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS preserve_charge_category ON pricing_charges;
CREATE TRIGGER preserve_charge_category BEFORE UPDATE OF category ON pricing_charges FOR EACH ROW EXECUTE FUNCTION preserve_charge_category();
CREATE TABLE IF NOT EXISTS report_otb_snapshots (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,snapshot_date DATE NOT NULL,
 captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,timezone TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('LOCAL','CLOCK')),
 PRIMARY KEY(tenant_id,property_id,snapshot_date),FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS report_otb_days (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,snapshot_date DATE NOT NULL,stay_date DATE NOT NULL,
 sold INTEGER NOT NULL CHECK(sold>=0),available INTEGER CHECK(available>=0),
 PRIMARY KEY(tenant_id,property_id,snapshot_date,stay_date),
 FOREIGN KEY(tenant_id,property_id,snapshot_date) REFERENCES report_otb_snapshots(tenant_id,property_id,snapshot_date) ON DELETE CASCADE,
 CHECK(stay_date>=snapshot_date AND stay_date<snapshot_date+365)
);
CREATE TABLE IF NOT EXISTS report_otb_revenue (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,snapshot_date DATE NOT NULL,stay_date DATE NOT NULL,currency VARCHAR(3) NOT NULL,
 sold INTEGER NOT NULL CHECK(sold>=0),room_revenue_minor NUMERIC(24,0),
 PRIMARY KEY(tenant_id,property_id,snapshot_date,stay_date,currency),
 FOREIGN KEY(tenant_id,property_id,snapshot_date,stay_date) REFERENCES report_otb_days(tenant_id,property_id,snapshot_date,stay_date) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS guest_capture_operations (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,idempotency_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL,response JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,property_id,idempotency_key),FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
DO $$ DECLARE tab TEXT; BEGIN FOREACH tab IN ARRAY ARRAY['report_otb_snapshots','report_otb_days','report_otb_revenue','guest_capture_operations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('DROP POLICY IF EXISTS capture_scope ON %I',tab);
 EXECUTE format('CREATE POLICY capture_scope ON %I USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())',tab);
 END LOOP; END $$;
