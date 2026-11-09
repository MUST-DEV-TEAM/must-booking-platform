-- The Clock health checks (stale webhook, stuck booking) run under the platform role, and row-level security hides
-- connections and bookings from it, so both alerts could never fire. Like clock_connected_properties(), these two
-- narrow functions return only what the checks need (never credentials or guest data) and refuse to run unless the
-- API set the platform_admin role.
-- Rollback: DROP FUNCTION "clock_connection_health"(); DROP FUNCTION "stuck_in_flight_bookings"("BookingStatus"[], TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION "clock_connection_health"()
RETURNS TABLE ("id" UUID, "tenantId" UUID, "lastWebhookReceivedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.role', true) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'clock_connection_health requires the platform admin role.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT c."id", c."tenant_id", c."last_webhook_received_at", c."created_at"
  FROM public."integration_connections" c
  JOIN public."property_integration_connections" pic
    ON pic."tenant_id" = c."tenant_id" AND pic."connection_id" = c."id"
  WHERE c."kind" = 'PMS' AND c."provider" = 'CLOCK_PMS' AND c."status" = 'CONNECTED'
    AND pic."enabled" = true;
END;
$$;

CREATE OR REPLACE FUNCTION "stuck_in_flight_bookings"(statuses "BookingStatus"[], cutoff TIMESTAMPTZ)
RETURNS TABLE ("id" UUID, "tenantId" UUID, "propertyId" UUID, "status" TEXT, "updatedAt" TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.role', true) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'stuck_in_flight_bookings requires the platform admin role.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT b."id", b."tenant_id", b."property_id", b."status"::text, b."updated_at"
  FROM public."bookings" b
  WHERE b."status" = ANY(statuses) AND b."updated_at" < cutoff;
END;
$$;

REVOKE ALL ON FUNCTION "clock_connection_health"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "stuck_in_flight_bookings"("BookingStatus"[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "clock_connection_health"() TO must_booking_app;
GRANT EXECUTE ON FUNCTION "stuck_in_flight_bookings"("BookingStatus"[], TIMESTAMPTZ) TO must_booking_app;
