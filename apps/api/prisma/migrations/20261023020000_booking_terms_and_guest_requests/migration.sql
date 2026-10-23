-- Owner-approved immutable terms for NEW MUST bookings; no historical backfill.
-- Rollback: retain/export terms and guest requests; stop new callers, restore prior functions/triggers,
-- and remove new fields only after guest-origin requests have been archived without loss.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_terms JSONB;
CREATE OR REPLACE FUNCTION capture_must_booking_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings record; cutoff timestamptz;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.cancellation_terms IS DISTINCT FROM NEW.cancellation_terms THEN RAISE EXCEPTION 'Agreed cancellation terms are immutable'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.source IN ('DIRECT','WEBSITE') AND NEW.external_booking_id IS NULL THEN
  SELECT p.timezone,p.auto_refund_on_free_cancellation AS auto_refund,
   COALESCE(cp.free_cancellation_days_before_arrival*24,rp.free_cancellation_until_hours,p.free_cancellation_days_before_arrival*24) AS hours,
   COALESCE(cp.name,rp.name,p.name) AS policy_name, COALESCE(p.check_in_time,'15:00') AS check_in
  INTO settings FROM properties p JOIN rate_plans rp ON rp.tenant_id=p.tenant_id AND rp.property_id=p.id AND rp.id=NEW.rate_plan_id
  LEFT JOIN cancellation_policies cp ON cp.tenant_id=rp.tenant_id AND cp.property_id=rp.property_id AND cp.id=rp.cancellation_policy_id
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.property_id;
  cutoff:=((NEW.starts_on+settings.check_in::time) AT TIME ZONE settings.timezone)-make_interval(hours=>settings.hours);
  NEW.cancellation_terms:=jsonb_build_object('version',1,'source','MUST','capturedAt',now(),'arrivalDate',NEW.starts_on,'timezone',settings.timezone,'freeCancellationUntilHours',settings.hours,'cutoffAt',cutoff,'autoRefund',settings.auto_refund,'policyName',settings.policy_name);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bookings_capture_terms ON bookings;
CREATE TRIGGER bookings_capture_terms BEFORE INSERT OR UPDATE OF cancellation_terms ON bookings FOR EACH ROW EXECUTE FUNCTION capture_must_booking_terms();
ALTER TABLE booking_requests ALTER COLUMN requester_id DROP NOT NULL;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS guest_session_id UUID;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='booking_requests_origin_check' AND conrelid='booking_requests'::regclass) THEN
  ALTER TABLE booking_requests ADD CONSTRAINT booking_requests_origin_check CHECK((requester_id IS NULL)<>(guest_session_id IS NULL));
 END IF;
END $$;
CREATE OR REPLACE FUNCTION booking_request_guest_origin_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.guest_session_id IS DISTINCT FROM OLD.guest_session_id OR NEW.requester_id IS DISTINCT FROM OLD.requester_id THEN RAISE EXCEPTION 'Request origin is immutable'; END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS booking_requests_guest_origin_immutable ON booking_requests;
CREATE TRIGGER booking_requests_guest_origin_immutable BEFORE UPDATE ON booking_requests FOR EACH ROW EXECUTE FUNCTION booking_request_guest_origin_immutable();
