-- Round-robin polling prevents old unpaid orders from starving newer payment holds.
ALTER TABLE venue_deposit_operations ADD COLUMN IF NOT EXISTS last_polled_at timestamptz;
CREATE OR REPLACE FUNCTION venue_deposit_sweep_candidates(maximum_rows integer DEFAULT 100)
RETURNS TABLE("tenantId" uuid,"venueId" uuid,"propertyId" uuid,"reservationId" uuid,"externalPaymentId" text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT r.tenant_id,r.venue_id,v.property_id,r.id,o.external_payment_id
 FROM venue_reservations r JOIN venues v ON v.tenant_id=r.tenant_id AND v.id=r.venue_id
 LEFT JOIN venue_deposit_operations o ON o.tenant_id=r.tenant_id AND o.venue_id=r.venue_id AND o.reservation_id=r.id AND o.kind='checkout'
 WHERE (r.status='pending_payment' AND r.payment_hold_expires_at IS NOT NULL)
 OR (o.state IN ('READY','UNCERTAIN') AND o.external_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM venue_deposit_receipts p WHERE p.tenant_id=r.tenant_id AND p.venue_id=r.venue_id AND p.reservation_id=r.id AND p.kind='CHARGE'))
 ORDER BY o.last_polled_at NULLS FIRST,r.created_at,r.id LIMIT LEAST(GREATEST(maximum_rows,1),100)
$$;
REVOKE ALL ON FUNCTION venue_deposit_sweep_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION venue_deposit_sweep_candidates(integer) TO must_booking_app;
