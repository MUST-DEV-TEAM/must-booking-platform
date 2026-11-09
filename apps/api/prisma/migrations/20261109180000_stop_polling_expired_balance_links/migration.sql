-- Stop re-checking balance-collection links that can no longer be paid. A link is valid for 7 days (BALANCE_LINK_VALID_MINUTES); one day of grace is kept for a payment made at the last moment. Before this, an abandoned link stayed READY forever and PokPay was asked about it every minute.
-- Rollback: restore payment_pending_pokpay_candidates from 20261021130000_confirmed_balance_collection.
CREATE OR REPLACE FUNCTION "payment_pending_pokpay_candidates"(maximum_rows INTEGER DEFAULT 100)
RETURNS TABLE ("bookingId" UUID, "tenantId" UUID, "propertyId" UUID, "externalPaymentId" TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT s.booking_id,s.tenant_id,s.property_id,s.external_payment_id
 FROM payment_provider_sessions s
 JOIN bookings b ON b.tenant_id=s.tenant_id AND b.property_id=s.property_id AND b.id=s.booking_id
 WHERE s.provider='pokpay' AND (b.status='PAYMENT_PENDING'::"BookingStatus" OR EXISTS(
  SELECT 1 FROM integration_operations o WHERE o.tenant_id=s.tenant_id AND o.property_id=s.property_id
   AND o.aggregate_id=s.booking_id AND o.external_reference=s.external_payment_id
   AND o.result->>'kind'='balance_collection' AND o.result->>'stage'='READY'
   AND o.created_at > now() - interval '8 days'))
 ORDER BY s.created_at,s.id LIMIT LEAST(GREATEST(maximum_rows,1),100)
$$;
REVOKE ALL ON FUNCTION "payment_pending_pokpay_candidates"(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "payment_pending_pokpay_candidates"(INTEGER) TO must_booking_app;
