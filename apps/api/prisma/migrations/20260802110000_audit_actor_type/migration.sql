-- Milestone 8, Task 4: distinguish MUST platform actors from tenant users.

DO $$
BEGIN
  CREATE TYPE "AuditActorType" AS ENUM ('TENANT_USER', 'PLATFORM_ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "actor_type" "AuditActorType" NOT NULL DEFAULT 'TENANT_USER';
