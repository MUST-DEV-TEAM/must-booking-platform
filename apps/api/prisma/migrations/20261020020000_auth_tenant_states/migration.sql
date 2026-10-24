-- Milestone 24, platform admin console: hotel login enforcement needs to know the lifecycle state
-- of every hotel a user belongs to before any tenant context exists (same pattern as
-- auth_list_user_tenants).

CREATE OR REPLACE FUNCTION "auth_user_tenant_states"(p_user_id UUID)
RETURNS TABLE ("tenantId" UUID, "lifecycleState" TEXT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT tm."tenant_id", o."lifecycle_state"::text
  FROM public."tenant_memberships" tm
  JOIN public."organizations" o ON o."id" = tm."tenant_id"
  WHERE tm."user_id" = p_user_id;
$$;

REVOKE ALL ON FUNCTION "auth_user_tenant_states"(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_user_tenant_states"(UUID) TO must_booking_app;
