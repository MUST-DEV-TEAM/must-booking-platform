-- Backfill capabilities and built-in role templates for properties created
-- before ensureBuiltInTemplates was wired into production property creation
-- (signup and PropertiesService.create()). Before that fix, only test
-- fixtures ever seeded these rows, so any pre-existing tenant/property has
-- an empty "capabilities" table -- which now means Owner/Admin sessions on
-- those tenants legitimately get 403 on every @RequiresCapability-gated
-- route, since that check now queries this table instead of bypassing
-- unconditionally. Fully idempotent (ON CONFLICT DO NOTHING throughout),
-- safe to run against a database that already has some or all of this data.

-- 1. Seed the 10 built-in capabilities for every tenant that has at least one property.
INSERT INTO "capabilities" ("tenant_id", "key", "description")
SELECT DISTINCT p."tenant_id", c."key", c."description"
FROM "properties" p
CROSS JOIN (VALUES
  ('staff.invite', 'Invite property staff'),
  ('staff.manage_permissions', 'Manage property-staff permissions'),
  ('settings.manage', 'Manage property settings'),
  ('reports.view', 'View property reports'),
  ('guests.manage', 'Manage guests'),
  ('bookings.manage', 'Manage bookings'),
  ('calendar.view', 'View property calendar'),
  ('accommodations.manage', 'Manage accommodations'),
  ('rates.manage', 'Manage rates and pricing'),
  ('payments.refund', 'Refund payments')
) AS c("key", "description")
ON CONFLICT ("tenant_id", "key") DO NOTHING;

-- 2. Seed the "Property Manager" and "Front Desk" built-in templates for every property.
INSERT INTO "property_role_templates" ("tenant_id", "property_id", "name", "kind")
SELECT p."tenant_id", p."id", t."name", 'BUILT_IN'::"PropertyRoleTemplateKind"
FROM "properties" p
CROSS JOIN (VALUES ('Property Manager'), ('Front Desk')) AS t("name")
ON CONFLICT ("tenant_id", "property_id", "name") DO NOTHING;

-- 3. "Property Manager" gets every capability.
INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
SELECT prt."tenant_id", prt."property_id", prt."id", c."id"
FROM "property_role_templates" prt
JOIN "capabilities" c ON c."tenant_id" = prt."tenant_id"
WHERE prt."name" = 'Property Manager' AND prt."kind" = 'BUILT_IN'
ON CONFLICT ("tenant_id", "property_id", "role_template_id", "capability_id") DO NOTHING;

-- 4. "Front Desk" gets its default subset (matches PropertyRoleTemplatesService's current defaults).
INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
SELECT prt."tenant_id", prt."property_id", prt."id", c."id"
FROM "property_role_templates" prt
JOIN "capabilities" c ON c."tenant_id" = prt."tenant_id"
WHERE prt."name" = 'Front Desk' AND prt."kind" = 'BUILT_IN'
  AND c."key" IN ('bookings.manage', 'calendar.view', 'guests.manage')
ON CONFLICT ("tenant_id", "property_id", "role_template_id", "capability_id") DO NOTHING;
