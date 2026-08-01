-- Milestone 8, Task 2: tenant status storage for platform administration.
-- State transitions are intentionally implemented with Task 3's endpoints.

DO $$
BEGIN
  CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';
