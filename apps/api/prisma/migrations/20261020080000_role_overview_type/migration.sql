-- Which Overview a role sees. 'auto' lets the system pick from the role's permissions.
ALTER TABLE property_role_templates
  ADD COLUMN IF NOT EXISTS overview_type varchar(20) NOT NULL DEFAULT 'auto';
ALTER TABLE property_role_templates DROP CONSTRAINT IF EXISTS property_role_templates_overview_type_check;
ALTER TABLE property_role_templates
  ADD CONSTRAINT property_role_templates_overview_type_check
  CHECK (overview_type IN ('auto','owner_manager','front_desk','finance','reservations','minimal'));
-- Rollback: ALTER TABLE property_role_templates DROP COLUMN overview_type;
