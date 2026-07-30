ALTER TABLE IF EXISTS "audit_logs"
  ALTER COLUMN "actor_user_id" DROP NOT NULL;
