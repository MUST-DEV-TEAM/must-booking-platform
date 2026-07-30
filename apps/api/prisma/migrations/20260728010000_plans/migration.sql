-- Milestone 2, Task 1: platform plan catalog and the permanent Free default.
-- The limits seeded below are illustrative only; the commercial catalog is finalized
-- at Milestone 8 kickoff (docs/BILLING.md).
CREATE TABLE IF NOT EXISTS "plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "max_properties" INTEGER NOT NULL,
  "max_staff_seats" INTEGER NOT NULL,
  "pms_enabled" BOOLEAN NOT NULL DEFAULT false,
  "max_pms_connections_per_property" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plans_name_key" UNIQUE ("name"),
  CONSTRAINT "plans_max_properties_check" CHECK ("max_properties" >= 0),
  CONSTRAINT "plans_max_staff_seats_check" CHECK ("max_staff_seats" >= 0),
  CONSTRAINT "plans_max_pms_connections_per_property_check" CHECK ("max_pms_connections_per_property" >= 0),
  CONSTRAINT "plans_pms_connection_gate_check" CHECK (
    "pms_enabled" OR "max_pms_connections_per_property" = 0
  )
);

-- The stable ID allows the organizations default to refer to the seeded Free plan.
INSERT INTO "plans" (
  "id",
  "name",
  "max_properties",
  "max_staff_seats",
  "pms_enabled",
  "max_pms_connections_per_property"
)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Free',
  1,
  3,
  false,
  0
)
ON CONFLICT ("id") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "max_properties" = EXCLUDED."max_properties",
  "max_staff_seats" = EXCLUDED."max_staff_seats",
  "pms_enabled" = EXCLUDED."pms_enabled",
  "max_pms_connections_per_property" = EXCLUDED."max_pms_connections_per_property";

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "plan_id" UUID;

UPDATE "organizations"
SET "plan_id" = '00000000-0000-0000-0000-000000000001'::uuid
WHERE "plan_id" IS NULL;

ALTER TABLE "organizations"
  ALTER COLUMN "plan_id" SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  ALTER COLUMN "plan_id" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "organizations_plan_id_idx" ON "organizations"("plan_id");
