-- Additive function change only. Existing booking checkout selection is preserved.
-- Rollback: restore payment_pending_pokpay_candidates from 20260731170000_pokpay_payment_provider.
CREATE OR REPLACE FUNCTION "payment_pending_pokpay_candidates"(maximum_rows INTEGER DEFAULT 100)
RETURNS TABLE ("bookingId" UUID, "tenantId" UUID, "propertyId" UUID, "externalPaymentId" TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT s.booking_id,s.tenant_id,s.property_id,s.external_payment_id
 FROM payment_provider_sessions s
 JOIN bookings b ON b.tenant_id=s.tenant_id AND b.property_id=s.property_id AND b.id=s.booking_id
 WHERE s.provider='pokpay' AND (b.status='PAYMENT_PENDING'::"BookingStatus" OR EXISTS(
  SELECT 1 FROM integration_operations o WHERE o.tenant_id=s.tenant_id AND o.property_id=s.property_id
   AND o.aggregate_id=s.booking_id AND o.external_reference=s.external_payment_id
   AND o.result->>'kind'='balance_collection' AND o.result->>'stage'='READY'))
 ORDER BY s.created_at,s.id LIMIT LEAST(GREATEST(maximum_rows,1),100)
$$;
REVOKE ALL ON FUNCTION "payment_pending_pokpay_candidates"(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "payment_pending_pokpay_candidates"(INTEGER) TO must_booking_app;
