-- Milestone 24, platform admin console: one cross-hotel summary for the hotel directory.
-- Returns counts and booleans only (never credentials or guest data) and refuses to run unless the
-- API has set the platform console role, which only authenticated console code does.

CREATE OR REPLACE FUNCTION "console_hotel_facts"()
RETURNS TABLE (
  "tenantId" UUID,
  "propertyCount" INTEGER,
  "staffCount" INTEGER,
  "hasClock" BOOLEAN,
  "hasPaymentConnection" BOOLEAN,
  "bookingCount" INTEGER,
  "lastBookingAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.role', true) IS DISTINCT FROM 'platform_console' THEN
    RAISE EXCEPTION 'console_hotel_facts requires the platform console role.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o."id",
    (SELECT COUNT(*)::int FROM public."properties" p WHERE p."tenant_id" = o."id"),
    (SELECT COUNT(*)::int FROM public."tenant_memberships" m WHERE m."tenant_id" = o."id"),
    EXISTS (SELECT 1 FROM public."integration_connections" c
      WHERE c."tenant_id" = o."id" AND c."provider" = 'CLOCK_PMS'),
    EXISTS (SELECT 1 FROM public."integration_connections" c
      WHERE c."tenant_id" = o."id" AND c."kind" = 'PAYMENT' AND c."status" = 'CONNECTED'),
    (SELECT COUNT(*)::int FROM public."bookings" b WHERE b."tenant_id" = o."id"),
    (SELECT MAX(b."created_at") FROM public."bookings" b WHERE b."tenant_id" = o."id")
  FROM public."organizations" o;
END;
$$;

REVOKE ALL ON FUNCTION "console_hotel_facts"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "console_hotel_facts"() TO must_booking_app;
