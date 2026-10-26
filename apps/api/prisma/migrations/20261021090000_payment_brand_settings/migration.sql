-- Additive settings. Roll back by restoring the preceding expiry function and resetting
-- holds to 30 / automatic refunds to true before deploying the old application. Retain columns.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS online_payment_hold_minutes integer NOT NULL DEFAULT 30 CHECK (online_payment_hold_minutes BETWEEN 10 AND 1440);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS auto_refund_on_free_cancellation boolean NOT NULL DEFAULT true;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS brand_colour varchar(7) CHECK (brand_colour IS NULL OR brand_colour ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE properties ADD COLUMN IF NOT EXISTS email_footer_text varchar(300);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS terms_url varchar(2048);
-- Same privileged candidate discovery boundary; subsequent mutation remains tenant/property RLS scoped.
CREATE OR REPLACE FUNCTION payment_pending_expiry_candidates(cutoff_at TIMESTAMPTZ, maximum_rows INTEGER DEFAULT 100)
RETURNS TABLE ("bookingId" UUID,"tenantId" UUID,"propertyId" UUID)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT b.id,b.tenant_id,b.property_id FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
 WHERE b.status='PAYMENT_PENDING'::"BookingStatus" AND b.created_at <= cutoff_at + interval '30 minutes' - p.online_payment_hold_minutes * interval '1 minute'
 ORDER BY b.created_at,b.id LIMIT GREATEST(maximum_rows,1)
$$;
REVOKE ALL ON FUNCTION payment_pending_expiry_candidates(TIMESTAMPTZ,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_pending_expiry_candidates(TIMESTAMPTZ,INTEGER) TO must_booking_app;
