-- Unpaid online-payment holds that end within the next `window_minutes`, one row per order. Same privileged
-- candidate discovery boundary as payment_pending_expiry_candidates; sending the email stays tenant RLS scoped.
CREATE OR REPLACE FUNCTION payment_pending_expiring_candidates(window_minutes INTEGER, maximum_rows INTEGER DEFAULT 100)
RETURNS TABLE ("bookingId" UUID, "tenantId" UUID, "propertyId" UUID, "expiresAt" TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT DISTINCT ON (b.tenant_id, b.property_id, COALESCE(b.order_reference, b.id::text))
   b.id, b.tenant_id, b.property_id, b.created_at + p.online_payment_hold_minutes * interval '1 minute'
 FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
 WHERE b.status='PAYMENT_PENDING'::"BookingStatus"
   AND b.payment_method='POKPAY'::"BookingPaymentMethod"
   AND p.online_payment_hold_minutes > window_minutes
   AND b.created_at + p.online_payment_hold_minutes * interval '1 minute' > now()
   AND b.created_at + (p.online_payment_hold_minutes - window_minutes) * interval '1 minute' <= now()
 ORDER BY b.tenant_id, b.property_id, COALESCE(b.order_reference, b.id::text), b.order_room_number NULLS FIRST, b.id
 LIMIT GREATEST(maximum_rows, 1)
$$;
REVOKE ALL ON FUNCTION payment_pending_expiring_candidates(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_pending_expiring_candidates(INTEGER, INTEGER) TO must_booking_app;
