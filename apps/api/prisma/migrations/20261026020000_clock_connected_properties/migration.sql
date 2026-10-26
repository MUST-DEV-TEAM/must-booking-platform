-- The daily Clock permissions check needs the list of hotels with a working Clock connection across all
-- tenants. Row-level security hides connections from the platform role, so this narrow function returns
-- only the ids (never credentials) and refuses to run unless the API set the platform_admin role.
CREATE OR REPLACE FUNCTION "clock_connected_properties"()
RETURNS TABLE ("tenantId" UUID, "propertyId" UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.role', true) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'clock_connected_properties requires the platform admin role.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT pic."tenant_id", pic."property_id"
  FROM public."integration_connections" c
  JOIN public."property_integration_connections" pic
    ON pic."tenant_id" = c."tenant_id" AND pic."connection_id" = c."id"
  WHERE c."kind" = 'PMS' AND c."provider" = 'CLOCK_PMS' AND c."status" = 'CONNECTED'
    AND pic."enabled" = true;
END;
$$;

REVOKE ALL ON FUNCTION "clock_connected_properties"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "clock_connected_properties"() TO must_booking_app;
