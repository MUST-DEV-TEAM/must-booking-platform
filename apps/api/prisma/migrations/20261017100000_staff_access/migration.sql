-- Staff and access (Milestone 24): finer permissions, custom role descriptions, staff names,
-- per-hotel suspension and who created an account.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "first_name" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "last_name" VARCHAR(100);

ALTER TABLE "property_staff_assignments"
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "created_by_user_id" UUID;

ALTER TABLE "property_role_templates"
  ADD COLUMN IF NOT EXISTS "description" VARCHAR(300);

-- 1. The new permission keys exist for every hotel group that already has permissions.
INSERT INTO "capabilities" ("tenant_id", "key", "description")
SELECT t."tenant_id", v."key", v."description"
FROM (SELECT DISTINCT "tenant_id" FROM "capabilities") t
CROSS JOIN (VALUES
  ('bookings.view', 'View bookings'),
  ('bookings.create', 'Create bookings'),
  ('bookings.edit', 'Edit bookings'),
  ('bookings.cancel', 'Cancel bookings'),
  ('calendar.view', 'View the calendar'),
  ('calendar.block', 'Block availability'),
  ('guests.view', 'View guests'),
  ('guests.merge', 'Merge guests'),
  ('payments.view', 'View payments'),
  ('payments.record', 'Record payments'),
  ('payments.refund', 'Refund payments'),
  ('accommodations.manage', 'Manage accommodations'),
  ('photos.manage', 'Manage photos'),
  ('rates.manage', 'Manage rates'),
  ('reports.view', 'View reports'),
  ('settings.manage', 'Manage settings'),
  ('staff.view', 'View staff'),
  ('staff.create', 'Add staff'),
  ('staff.manage_roles', 'Manage roles'),
  ('staff.manage_permissions', 'Manage permissions'),
  ('staff.suspend', 'Suspend staff')
) AS v("key", "description")
ON CONFLICT ("tenant_id", "key") DO NOTHING;

-- 2. What an old permission meant, in the new permissions. Nobody loses or gains access: an old
--    coarse permission becomes every finer permission it used to cover.
DROP TABLE IF EXISTS "_capability_map";
CREATE TEMP TABLE "_capability_map" ("legacy" TEXT NOT NULL, "fine" TEXT NOT NULL);
INSERT INTO "_capability_map" ("legacy", "fine") VALUES
  ('bookings.manage', 'bookings.view'),
  ('bookings.manage', 'bookings.create'),
  ('bookings.manage', 'bookings.edit'),
  ('bookings.manage', 'bookings.cancel'),
  ('bookings.manage', 'payments.record'),
  ('guests.manage', 'guests.view'),
  ('guests.manage', 'guests.merge'),
  ('staff.invite', 'staff.view'),
  ('staff.invite', 'staff.create'),
  ('staff.manage_permissions', 'staff.view'),
  ('staff.manage_permissions', 'staff.manage_roles'),
  ('staff.manage_permissions', 'staff.suspend'),
  ('staff.manage_permissions', 'staff.create'),
  ('payments.refund', 'payments.view');

INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
SELECT rtc."tenant_id", rtc."property_id", rtc."role_template_id", nc."id"
FROM "property_role_template_capabilities" rtc
JOIN "capabilities" oc ON oc."tenant_id" = rtc."tenant_id" AND oc."id" = rtc."capability_id"
JOIN "_capability_map" m ON m."legacy" = oc."key"
JOIN "capabilities" nc ON nc."tenant_id" = rtc."tenant_id" AND nc."key" = m."fine"
ON CONFLICT DO NOTHING;

INSERT INTO "property_staff_capability_overrides" ("tenant_id", "property_id", "user_id", "capability_id", "granted")
SELECT o."tenant_id", o."property_id", o."user_id", nc."id", o."granted"
FROM "property_staff_capability_overrides" o
JOIN "capabilities" oc ON oc."tenant_id" = o."tenant_id" AND oc."id" = o."capability_id"
JOIN "_capability_map" m ON m."legacy" = oc."key"
JOIN "capabilities" nc ON nc."tenant_id" = o."tenant_id" AND nc."key" = m."fine"
ON CONFLICT DO NOTHING;

-- 3. The three built-in roles get the descriptions and the permissions of the new catalog.
UPDATE "property_role_templates" SET "description" = 'Runs the hotel day to day: everything except changing who is an owner.'
  WHERE "kind" = 'BUILT_IN' AND "name" = 'Property Manager' AND "description" IS NULL;
UPDATE "property_role_templates" SET "description" = 'Handles bookings, the calendar and guests at reception.'
  WHERE "kind" = 'BUILT_IN' AND "name" = 'Front Desk' AND "description" IS NULL;
UPDATE "property_role_templates" SET "description" = 'Sees payments and reports and can refund.'
  WHERE "kind" = 'BUILT_IN' AND "name" = 'Finance' AND "description" IS NULL;

INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
SELECT prt."tenant_id", prt."property_id", prt."id", c."id"
FROM "property_role_templates" prt
JOIN "capabilities" c ON c."tenant_id" = prt."tenant_id"
WHERE prt."kind" = 'BUILT_IN' AND prt."name" = 'Property Manager'
ON CONFLICT DO NOTHING;

INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
SELECT prt."tenant_id", prt."property_id", prt."id", c."id"
FROM "property_role_templates" prt
JOIN "capabilities" c ON c."tenant_id" = prt."tenant_id"
WHERE prt."kind" = 'BUILT_IN' AND prt."name" = 'Finance'
  AND c."key" IN ('payments.view', 'payments.refund', 'reports.view', 'bookings.view')
ON CONFLICT DO NOTHING;

-- 4. The old coarse keys that no longer exist.
DELETE FROM "property_staff_capability_overrides" o USING "capabilities" c
  WHERE c."tenant_id" = o."tenant_id" AND c."id" = o."capability_id"
    AND c."key" IN ('bookings.manage', 'guests.manage', 'staff.invite');
DELETE FROM "property_role_template_capabilities" rtc USING "capabilities" c
  WHERE c."tenant_id" = rtc."tenant_id" AND c."id" = rtc."capability_id"
    AND c."key" IN ('bookings.manage', 'guests.manage', 'staff.invite');
DELETE FROM "capabilities" WHERE "key" IN ('bookings.manage', 'guests.manage', 'staff.invite');

DROP TABLE "_capability_map";
