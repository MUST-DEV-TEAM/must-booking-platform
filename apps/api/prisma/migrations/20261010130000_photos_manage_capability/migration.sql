-- New "photos.manage" capability: who may upload, reorder and delete room and
-- property photos. Owners and admins get every capability automatically; staff
-- get it through a role template or a per-person grant. Idempotent.

-- 1. Seed the capability for every tenant that has at least one property.
INSERT INTO "capabilities" ("tenant_id", "key", "description")
SELECT DISTINCT p."tenant_id", 'photos.manage', 'Manage room and property photos'
FROM "properties" p
ON CONFLICT ("tenant_id", "key") DO NOTHING;

-- 2. "Property Manager" keeps "every capability", so it gets this one too.
INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
SELECT prt."tenant_id", prt."property_id", prt."id", c."id"
FROM "property_role_templates" prt
JOIN "capabilities" c ON c."tenant_id" = prt."tenant_id" AND c."key" = 'photos.manage'
WHERE prt."name" = 'Property Manager' AND prt."kind" = 'BUILT_IN'
ON CONFLICT ("tenant_id", "property_id", "role_template_id", "capability_id") DO NOTHING;
