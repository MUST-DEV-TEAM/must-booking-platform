-- Refund after the 24-hour window is its own permission: owners and admins have every permission, and the
-- Property Manager role gets it here. Finance and Front Desk do not.
INSERT INTO "capabilities" ("tenant_id", "key", "description")
SELECT t."tenant_id", 'payments.refund_late', 'Refund after 24 hours'
FROM (SELECT DISTINCT "tenant_id" FROM "capabilities") t
ON CONFLICT ("tenant_id", "key") DO NOTHING;

INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
SELECT rt."tenant_id", rt."property_id", rt."id", c."id"
FROM "property_role_templates" rt
JOIN "capabilities" c ON c."tenant_id" = rt."tenant_id" AND c."key" = 'payments.refund_late'
WHERE rt."name" = 'Property Manager'
ON CONFLICT DO NOTHING;

-- Rollback: DELETE the property_role_template_capabilities rows and the capabilities rows with this key.
