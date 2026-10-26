-- Plan visibility: only public plans may ever be offered to customers (signup, upgrade screens).
-- Non-public plans (Internal Testing, future Enterprise) are assigned by a platform admin only.
-- Existing plans stay public so current behavior does not change.
ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "is_public" BOOLEAN NOT NULL DEFAULT true;

-- Stable ID so environments and seed scripts can refer to the testing tier.
-- Limits are generous on purpose: this tier exists for QA and demos, never for customers.
INSERT INTO "plans" (
  "id",
  "name",
  "max_properties",
  "max_staff_seats",
  "pms_enabled",
  "max_pms_connections_per_property",
  "is_public"
)
VALUES (
  '00000000-0000-0000-0000-000000000099'::uuid,
  'Internal Testing',
  10,
  25,
  true,
  3,
  false
)
ON CONFLICT ("id") DO NOTHING;
