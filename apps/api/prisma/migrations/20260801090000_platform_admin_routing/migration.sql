-- Milestone 7, Task 3: platform-admin identity and the no-dual-role invariant.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_platform_admin" BOOLEAN NOT NULL DEFAULT false;

-- Authentication needs to resolve this flag before a tenant context exists.
CREATE OR REPLACE FUNCTION "auth_is_platform_admin"(input_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    (SELECT u."is_platform_admin" FROM public."users" u WHERE u."id" = input_user_id),
    false
  );
$$;

REVOKE ALL ON FUNCTION "auth_is_platform_admin"(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_is_platform_admin"(UUID) TO must_booking_app;

-- A platform account is never also a tenant member. Keep this invariant at the
-- database boundary so seed/admin paths cannot accidentally create dual-role accounts.
CREATE OR REPLACE FUNCTION "auth_assert_platform_user_is_exclusive"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."is_platform_admin" AND EXISTS (
    SELECT 1 FROM public."tenant_memberships" tm WHERE tm."user_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Platform admin accounts cannot have tenant memberships.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "auth_assert_tenant_membership_is_exclusive"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."users" u
    WHERE u."id" = NEW."user_id" AND u."is_platform_admin"
  ) THEN
    RAISE EXCEPTION 'Platform admin accounts cannot have tenant memberships.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "users_platform_role_exclusive" ON "users";
CREATE TRIGGER "users_platform_role_exclusive"
  BEFORE INSERT OR UPDATE OF "is_platform_admin" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "auth_assert_platform_user_is_exclusive"();

DROP TRIGGER IF EXISTS "tenant_memberships_platform_role_exclusive" ON "tenant_memberships";
CREATE TRIGGER "tenant_memberships_platform_role_exclusive"
  BEFORE INSERT OR UPDATE OF "user_id" ON "tenant_memberships"
  FOR EACH ROW EXECUTE FUNCTION "auth_assert_tenant_membership_is_exclusive"();
