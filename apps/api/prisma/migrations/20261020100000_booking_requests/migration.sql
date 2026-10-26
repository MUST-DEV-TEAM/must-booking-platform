-- B1: exact tenant/hotel scope; no existing staff grants change.
CREATE TABLE IF NOT EXISTS booking_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, property_id uuid NOT NULL,
 booking_id uuid NOT NULL, type text NOT NULL DEFAULT 'cancellation' CHECK(type IN ('cancellation','amendment')),
 requester_id uuid NOT NULL REFERENCES users(id), reason_category text NOT NULL CHECK(reason_category IN ('guest_request','travel_change','medical','hotel_issue','other')),
 priority text NOT NULL CHECK(priority IN ('normal','high','urgent')), details varchar(2000) NOT NULL,
 status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected','Cancelled')),
 execution_actor_id uuid REFERENCES users(id), execution_note varchar(1000),
 reviewer_id uuid REFERENCES users(id), decision_note varchar(1000), decided_at timestamptz,
 payload jsonb NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,property_id,id),
 FOREIGN KEY(tenant_id,property_id,booking_id) REFERENCES bookings(tenant_id,property_id,id),
 CHECK((status='Pending' AND reviewer_id IS NULL AND decision_note IS NULL AND decided_at IS NULL)
 OR (status<>'Pending' AND decision_note IS NOT NULL AND reviewer_id IS NOT NULL AND length(trim(decision_note))>0 AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_one_open ON booking_requests(tenant_id,property_id,booking_id,type) WHERE status='Pending';
ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exact_scope ON booking_requests;
CREATE POLICY exact_scope ON booking_requests
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
CREATE OR REPLACE FUNCTION booking_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'Pending' THEN RAISE EXCEPTION 'A request cannot be removed or a decision changed'; END IF;
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.property_id<>OLD.property_id OR NEW.booking_id<>OLD.booking_id
 OR NEW.payload<>OLD.payload OR NEW.requester_id<>OLD.requester_id OR NEW.type<>OLD.type THEN
 RAISE EXCEPTION 'Request evidence is immutable'; END IF;
 IF OLD.execution_actor_id IS NOT NULL AND
 (NEW.execution_actor_id IS DISTINCT FROM OLD.execution_actor_id OR NEW.execution_note IS DISTINCT FROM OLD.execution_note
  OR NEW.status IN ('Rejected','Cancelled') OR (NEW.status='Approved' AND (NEW.reviewer_id IS DISTINCT FROM OLD.execution_actor_id OR NEW.decision_note IS DISTINCT FROM OLD.execution_note))) THEN
 RAISE EXCEPTION 'Approval execution intent cannot be changed'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS booking_request_immutable ON booking_requests;
CREATE TRIGGER booking_request_immutable BEFORE UPDATE OR DELETE ON booking_requests FOR EACH ROW EXECUTE FUNCTION booking_request_immutable();
INSERT INTO capabilities(tenant_id,key,description)
 SELECT DISTINCT tenant_id,'requests.review','Review cancellation requests' FROM capabilities
 ON CONFLICT(tenant_id,key) DO NOTHING;
-- Rollback only after reverting B1 application code and exporting request/decision history:
-- DROP TABLE booking_requests; DROP FUNCTION booking_request_immutable();
-- Remove requests.review grants and capabilities only after checking for subsequent users of this key.
