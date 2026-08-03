ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_auto_provisioned" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" u
SET "is_auto_provisioned" = true
WHERE EXISTS (
  SELECT 1
  FROM "tenant_memberships" tm
  WHERE tm."user_id" = u."id" AND tm."is_auto_provisioned"
);

DROP POLICY IF EXISTS "users_auto_provisioned_orphan_delete" ON "users";
CREATE POLICY "users_auto_provisioned_orphan_delete" ON "users"
  FOR DELETE
  USING (
    "is_auto_provisioned"
    AND NOT EXISTS (
      SELECT 1 FROM "tenant_memberships" WHERE "user_id" = "users"."id"
    )
  );
