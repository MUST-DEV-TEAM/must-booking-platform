ALTER TABLE "tenant_memberships"
  ADD COLUMN IF NOT EXISTS "is_auto_provisioned" BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION "delete_orphaned_auto_provisioned_user"()
RETURNS TRIGGER
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS "tenant_memberships_delete_auto_provisioned_user" ON "tenant_memberships";
CREATE TRIGGER "tenant_memberships_delete_auto_provisioned_user"
AFTER DELETE ON "tenant_memberships"
FOR EACH ROW EXECUTE FUNCTION "delete_orphaned_auto_provisioned_user"();
