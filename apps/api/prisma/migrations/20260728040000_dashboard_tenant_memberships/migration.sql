-- Read-only membership lookup for the URL-based dashboard tenant picker.
CREATE OR REPLACE FUNCTION "auth_list_user_tenants"(p_user_id uuid)
RETURNS TABLE("tenantId" uuid, "organizationName" varchar, role text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id, o.name, m.role::text
  FROM tenant_memberships m JOIN organizations o ON o.id = m.tenant_id
  WHERE m.user_id = p_user_id ORDER BY o.name;
$$;

REVOKE ALL ON FUNCTION "auth_list_user_tenants"(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_list_user_tenants"(UUID) TO must_booking_app;
