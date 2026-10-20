-- Application-first rollback: stop custom dispatch; keep encrypted intentions/tombstones.
CREATE TABLE IF NOT EXISTS email_transport_attempts (
 tenant_id UUID NOT NULL, property_id UUID NOT NULL, message_id UUID NOT NULL,
 stage TEXT NOT NULL CHECK(stage IN ('PRIMARY','FALLBACK')),
 provider TEXT NOT NULL CHECK(provider IN ('resend','smtp')),
 state TEXT NOT NULL DEFAULT 'READY' CHECK(state IN ('READY','SENDING','ACCEPTED','REJECTED','UNKNOWN')),
 encrypted_payload TEXT, attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
 fence UUID, lease_expires_at TIMESTAMPTZ, retryable BOOLEAN NOT NULL DEFAULT false,
 provider_message_id TEXT CHECK(length(provider_message_id)<=200),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days',
 PRIMARY KEY(tenant_id,property_id,message_id,stage),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,property_id,message_id) REFERENCES email_messages(tenant_id,property_id,id) ON DELETE CASCADE,
 CHECK((state='SENDING') IS NOT TRUE OR (fence IS NOT NULL AND lease_expires_at IS NOT NULL AND attempt>0))
);
ALTER TABLE email_transport_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_transport_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_transport_attempt_scope ON email_transport_attempts;
CREATE POLICY email_transport_attempt_scope ON email_transport_attempts
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
