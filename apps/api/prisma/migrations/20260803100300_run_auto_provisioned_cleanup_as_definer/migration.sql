CREATE OR REPLACE FUNCTION "delete_orphaned_auto_provisioned_user"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD."is_auto_provisioned" AND NOT EXISTS (
    SELECT 1 FROM "tenant_memberships" WHERE "user_id" = OLD."user_id"
  ) THEN
    DELETE FROM "users" WHERE "id" = OLD."user_id";
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION "delete_orphaned_auto_provisioned_user"() FROM PUBLIC;
