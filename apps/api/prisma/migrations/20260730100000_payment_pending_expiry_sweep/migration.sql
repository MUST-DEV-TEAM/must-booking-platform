-- Milestone 5, Task 5: the background worker must discover expired payment holds
-- without bypassing tenant RLS for its subsequent booking/inventory transaction.
CREATE OR REPLACE FUNCTION "payment_pending_expiry_candidates"(
  cutoff_at TIMESTAMPTZ,
  maximum_rows INTEGER DEFAULT 100
)
RETURNS TABLE ("bookingId" UUID, "tenantId" UUID, "propertyId" UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.tenant_id, b.property_id
  FROM bookings b
  WHERE b.status = 'PAYMENT_PENDING'::"BookingStatus"
    AND b.created_at <= cutoff_at
  ORDER BY b.created_at, b.id
  LIMIT GREATEST(maximum_rows, 1)
$$;

REVOKE ALL ON FUNCTION "payment_pending_expiry_candidates"(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "payment_pending_expiry_candidates"(TIMESTAMPTZ, INTEGER)
  TO must_booking_app;
