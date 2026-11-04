-- Additive restaurant guest-payment support. Hotel and subscription ledgers are unchanged.
-- Application rollback can leave these additions in place. Do not remove financial records.
-- Before restoring booking_id NOT NULL, stop restaurant checkout writers and preserve/migrate all
-- restaurant session bindings and receipts with an owner-approved rollback; never delete them.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS deposit_rules_version integer NOT NULL DEFAULT 0;
ALTER TABLE venue_reservations ADD COLUMN IF NOT EXISTS request_key uuid;
ALTER TABLE venue_reservations ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE venue_reservations ADD COLUMN IF NOT EXISTS deposit_terms jsonb;
ALTER TABLE venue_reservations ADD COLUMN IF NOT EXISTS payment_hold_expires_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS venue_reservations_request_key ON venue_reservations(tenant_id,venue_id,request_key) WHERE request_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS venue_deposit_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, venue_id uuid NOT NULL,
 service_id uuid, area_id uuid, mode text NOT NULL CHECK(mode IN ('none','per_guest','per_booking')),
 amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(amount>=0), min_party integer NOT NULL DEFAULT 1 CHECK(min_party BETWEEN 1 AND 500),
 free_cancel_hours integer NOT NULL DEFAULT 24 CHECK(free_cancel_hours BETWEEN 0 AND 8760),
 CHECK(area_id IS NULL OR service_id IS NOT NULL), CHECK((mode='none' AND amount=0) OR (mode<>'none' AND amount>0)),
 FOREIGN KEY(tenant_id,venue_id) REFERENCES venues(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,venue_id,service_id) REFERENCES venue_services(tenant_id,venue_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,venue_id,area_id) REFERENCES venue_areas(tenant_id,venue_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS venue_deposit_rules_scope ON venue_deposit_rules(tenant_id,venue_id,coalesce(service_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(area_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE TABLE IF NOT EXISTS venue_deposit_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, venue_id uuid NOT NULL, property_id uuid NOT NULL,
 reservation_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('checkout','refund','email')),
 state text NOT NULL DEFAULT 'PREPARING' CHECK(state IN ('PREPARING','READY','PAID','UNCERTAIN','REFUNDED','SENT')),
 amount numeric(12,2) NOT NULL CHECK(amount>=0), currency char(3) NOT NULL,
 external_payment_id text, checkout_url text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,venue_id,reservation_id,kind),
 FOREIGN KEY(tenant_id,venue_id,reservation_id) REFERENCES venue_reservations(tenant_id,venue_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS venue_deposit_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, venue_id uuid NOT NULL, property_id uuid NOT NULL,
 reservation_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('CHARGE','REFUND')),
 provider text NOT NULL DEFAULT 'pokpay' CHECK(provider='pokpay'), external_payment_id text NOT NULL,
 amount numeric(12,2) NOT NULL CHECK(amount>0), currency char(3) NOT NULL,
 requires_refund boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,provider,external_payment_id,kind),
 FOREIGN KEY(tenant_id,venue_id,reservation_id) REFERENCES venue_reservations(tenant_id,venue_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE payment_provider_sessions ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE payment_provider_sessions ADD COLUMN IF NOT EXISTS venue_id uuid;
ALTER TABLE payment_provider_sessions ADD COLUMN IF NOT EXISTS venue_reservation_id uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='payment_provider_sessions_booking_origin') THEN
  ALTER TABLE payment_provider_sessions ADD CONSTRAINT payment_provider_sessions_booking_origin CHECK (
   (booking_id IS NOT NULL AND venue_id IS NULL AND venue_reservation_id IS NULL) OR
   (booking_id IS NULL AND venue_id IS NOT NULL AND venue_reservation_id IS NOT NULL)
  );
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='payment_provider_sessions_venue_reservation_fk') THEN
  ALTER TABLE payment_provider_sessions ADD CONSTRAINT payment_provider_sessions_venue_reservation_fk FOREIGN KEY(tenant_id,venue_id,venue_reservation_id) REFERENCES venue_reservations(tenant_id,venue_id,id) ON DELETE RESTRICT;
 END IF;
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['venue_deposit_rules','venue_deposit_operations','venue_deposit_receipts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I',tbl);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=current_setting(''app.tenant_id'',true)::uuid) WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true)::uuid)',tbl);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON venue_deposit_rules,venue_deposit_operations TO must_booking_app;
GRANT SELECT,INSERT ON venue_deposit_receipts TO must_booking_app;
REVOKE UPDATE,DELETE ON venue_deposit_receipts FROM must_booking_app;
CREATE OR REPLACE FUNCTION venue_deposit_terms_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.deposit_terms IS DISTINCT FROM OLD.deposit_terms THEN RAISE EXCEPTION 'Accepted restaurant deposit terms are immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS venue_deposit_terms_immutable ON venue_reservations;
CREATE TRIGGER venue_deposit_terms_immutable BEFORE UPDATE OF deposit_terms ON venue_reservations FOR EACH ROW EXECUTE FUNCTION venue_deposit_terms_immutable();
CREATE OR REPLACE FUNCTION venue_deposit_sweep_candidates(maximum_rows integer DEFAULT 100)
RETURNS TABLE("tenantId" uuid,"venueId" uuid,"propertyId" uuid,"reservationId" uuid,"externalPaymentId" text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT r.tenant_id,r.venue_id,v.property_id,r.id,o.external_payment_id
 FROM venue_reservations r JOIN venues v ON v.tenant_id=r.tenant_id AND v.id=r.venue_id
 LEFT JOIN venue_deposit_operations o ON o.tenant_id=r.tenant_id AND o.venue_id=r.venue_id AND o.reservation_id=r.id AND o.kind='checkout'
 WHERE (r.status='pending_payment' AND r.payment_hold_expires_at IS NOT NULL)
 OR (o.state IN ('READY','UNCERTAIN') AND o.external_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM venue_deposit_receipts p WHERE p.tenant_id=r.tenant_id AND p.venue_id=r.venue_id AND p.reservation_id=r.id AND p.kind='CHARGE'))
 ORDER BY r.created_at,r.id LIMIT LEAST(GREATEST(maximum_rows,1),100)
$$;
REVOKE ALL ON FUNCTION venue_deposit_sweep_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION venue_deposit_sweep_candidates(integer) TO must_booking_app;

-- Bind restaurant payment records to the same property as their venue.
CREATE UNIQUE INDEX IF NOT EXISTS venues_tenant_property_id_key ON venues(tenant_id,property_id,id);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['venue_deposit_operations','venue_deposit_receipts','payment_provider_sessions'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname=tbl||'_venue_property_fk') THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(tenant_id,property_id,venue_id) REFERENCES venues(tenant_id,property_id,id) ON DELETE RESTRICT',tbl,tbl||'_venue_property_fk');
  END IF;
 END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS venue_deposit_operations_pending_idx ON venue_deposit_operations(state,created_at);
CREATE INDEX IF NOT EXISTS venue_deposit_reservations_hold_idx ON venue_reservations(payment_hold_expires_at) WHERE status='pending_payment';
