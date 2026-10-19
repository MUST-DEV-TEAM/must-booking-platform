ALTER TYPE "EmailMessageStatus" ADD VALUE IF NOT EXISTS 'SUPPRESSED';
CREATE TABLE IF NOT EXISTS email_suppressions (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,recipient VARCHAR(254) NOT NULL CHECK(recipient=lower(recipient)),
 reason TEXT NOT NULL CHECK(reason IN ('hard_bounce','complaint')),active BOOLEAN NOT NULL DEFAULT true,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 latest_event_at TIMESTAMPTZ NOT NULL,cleared_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,recipient),FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_suppression_scope ON email_suppressions;
CREATE POLICY email_suppression_scope ON email_suppressions USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
