-- Additive and safe to re-run. Rollback: restore the candidate functions from
-- 20261021090000_payment_brand_settings and 20261027030000_payment_link_expiring_candidates;
-- retain payment_pending_at and on_request_deadline_at for existing bookings.
CREATE INDEX IF NOT EXISTS bookings_on_request_deadline_idx
  ON bookings(on_request_deadline_at, id) WHERE status = 'ON_REQUEST_PENDING';

CREATE OR REPLACE FUNCTION on_request_expiry_candidates(cutoff_at timestamptz, maximum_rows integer DEFAULT 100)
RETURNS TABLE ("bookingId" uuid, "tenantId" uuid, "propertyId" uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT b.id,b.tenant_id,b.property_id FROM bookings b
 WHERE b.status='ON_REQUEST_PENDING'::"BookingStatus" AND b.on_request_deadline_at<=cutoff_at
   AND (b.order_room_number IS NULL OR b.order_room_number=1)
 ORDER BY b.on_request_deadline_at,b.id LIMIT GREATEST(maximum_rows,1)
$$;
REVOKE ALL ON FUNCTION on_request_expiry_candidates(timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION on_request_expiry_candidates(timestamptz,integer) TO must_booking_app;

CREATE OR REPLACE FUNCTION payment_pending_expiry_candidates(cutoff_at timestamptz, maximum_rows integer DEFAULT 100)
RETURNS TABLE ("bookingId" uuid,"tenantId" uuid,"propertyId" uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT b.id,b.tenant_id,b.property_id FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
 WHERE b.status='PAYMENT_PENDING'::"BookingStatus"
   AND COALESCE(b.payment_pending_at,b.created_at) <= cutoff_at + interval '30 minutes' - p.online_payment_hold_minutes * interval '1 minute'
 ORDER BY COALESCE(b.payment_pending_at,b.created_at),b.id LIMIT GREATEST(maximum_rows,1)
$$;
REVOKE ALL ON FUNCTION payment_pending_expiry_candidates(timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_pending_expiry_candidates(timestamptz,integer) TO must_booking_app;

CREATE OR REPLACE FUNCTION payment_pending_expiring_candidates(window_minutes integer, maximum_rows integer DEFAULT 100)
RETURNS TABLE ("bookingId" uuid,"tenantId" uuid,"propertyId" uuid,"expiresAt" timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT DISTINCT ON (b.tenant_id,b.property_id,COALESCE(b.order_reference,b.id::text))
   b.id,b.tenant_id,b.property_id,COALESCE(b.payment_pending_at,b.created_at) + p.online_payment_hold_minutes * interval '1 minute'
 FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
 WHERE b.status='PAYMENT_PENDING'::"BookingStatus"
   AND b.payment_method='POKPAY'::"BookingPaymentMethod"
   AND p.online_payment_hold_minutes>window_minutes
   AND COALESCE(b.payment_pending_at,b.created_at) + p.online_payment_hold_minutes * interval '1 minute'>now()
   AND COALESCE(b.payment_pending_at,b.created_at) + (p.online_payment_hold_minutes-window_minutes) * interval '1 minute'<=now()
 ORDER BY b.tenant_id,b.property_id,COALESCE(b.order_reference,b.id::text),b.order_room_number NULLS FIRST,b.id
 LIMIT GREATEST(maximum_rows,1)
$$;
REVOKE ALL ON FUNCTION payment_pending_expiring_candidates(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_pending_expiring_candidates(integer,integer) TO must_booking_app;
