CREATE OR REPLACE FUNCTION "delete_unassigned_auto_provisioned_membership"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "tenant_memberships"
  WHERE "tenant_id" = OLD."tenant_id"
    AND "user_id" = OLD."user_id"
    AND "is_auto_provisioned"
    AND NOT EXISTS (
      SELECT 1
      FROM "property_staff_assignments"
      WHERE "tenant_id" = OLD."tenant_id" AND "user_id" = OLD."user_id"
    );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "property_staff_assignments_delete_auto_provisioned_membership" ON "property_staff_assignments";
CREATE TRIGGER "property_staff_assignments_delete_auto_provisioned_membership"
AFTER DELETE ON "property_staff_assignments"
FOR EACH ROW EXECUTE FUNCTION "delete_unassigned_auto_provisioned_membership"();
