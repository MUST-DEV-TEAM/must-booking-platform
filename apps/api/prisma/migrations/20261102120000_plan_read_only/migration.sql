-- A read-only plan lets staff view every page but rejects all dashboard writes (Free tier).
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "read_only" BOOLEAN NOT NULL DEFAULT false;

-- Free: owner only, view-only, no PMS. Rollback: set read_only = false and max_staff_seats = 3.
UPDATE "plans"
SET "read_only" = true, "max_staff_seats" = 1, "updated_at" = now()
WHERE "id" = '00000000-0000-0000-0000-000000000001';
