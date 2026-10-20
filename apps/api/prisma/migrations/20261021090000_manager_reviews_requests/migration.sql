-- Built-in Property Manager roles may review cancellation requests. Additive and idempotent.
INSERT INTO property_role_template_capabilities(tenant_id,property_id,role_template_id,capability_id)
SELECT t.tenant_id,t.property_id,t.id,c.id
FROM property_role_templates t
JOIN capabilities c ON c.tenant_id=t.tenant_id AND c.key='requests.review'
WHERE t.kind='BUILT_IN' AND t.name='Property Manager'
ON CONFLICT (tenant_id,property_id,role_template_id,capability_id) DO NOTHING;
-- Rollback: DELETE the requests.review grants from built-in 'Property Manager' templates.
