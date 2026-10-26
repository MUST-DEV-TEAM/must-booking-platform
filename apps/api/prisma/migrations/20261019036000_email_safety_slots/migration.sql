CREATE UNIQUE INDEX IF NOT EXISTS email_message_scoped_identity ON email_messages(tenant_id,property_id,id);
CREATE TABLE IF NOT EXISTS email_delivery_slots (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,message_id UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,message_id),FOREIGN KEY(tenant_id,property_id,message_id) REFERENCES email_messages(tenant_id,property_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS email_delivery_slots_window ON email_delivery_slots(tenant_id,property_id,created_at);
ALTER TABLE email_delivery_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_slots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_delivery_slot_scope ON email_delivery_slots;
CREATE POLICY email_delivery_slot_scope ON email_delivery_slots USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
