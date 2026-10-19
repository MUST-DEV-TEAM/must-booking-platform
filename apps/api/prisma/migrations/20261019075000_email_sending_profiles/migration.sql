-- A saved custom sender stays inactive until its domain/mailbox and connection are verified.
CREATE TABLE IF NOT EXISTS email_sending_profiles (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 mode TEXT NOT NULL DEFAULT 'DEFAULT' CHECK(mode IN ('DEFAULT','RESEND','SMTP')),
 active_mode TEXT NOT NULL DEFAULT 'DEFAULT' CHECK(active_mode IN ('DEFAULT','RESEND','SMTP')),
 from_name TEXT,from_address TEXT,domain TEXT,smtp_host TEXT,smtp_port INTEGER,smtp_security TEXT,
 encrypted_credentials TEXT,credential_revision UUID,
 fallback_guest BOOLEAN NOT NULL DEFAULT true,
 from_verified_at TIMESTAMPTZ,connection_checked_at TIMESTAMPTZ,domain_checked_at TIMESTAMPTZ,
 domain_status TEXT NOT NULL DEFAULT 'unknown',dns_records JSONB NOT NULL DEFAULT '[]'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE CASCADE,
 CHECK((encrypted_credentials IS NULL)=(credential_revision IS NULL)),
 CHECK(mode='DEFAULT' OR (from_address IS NOT NULL AND encrypted_credentials IS NOT NULL)),
 CHECK(mode<>'SMTP' OR (smtp_host IS NOT NULL AND ((smtp_port=465 AND smtp_security='TLS') OR (smtp_port IN (587,2525) AND smtp_security='STARTTLS')))),
 CHECK(mode<>'RESEND' OR domain IS NOT NULL),
 CHECK(active_mode='DEFAULT' OR active_mode=mode),
 CHECK(active_mode<>'SMTP' OR (from_verified_at IS NOT NULL AND connection_checked_at IS NOT NULL)),
 CHECK(active_mode<>'RESEND' OR (domain_checked_at IS NOT NULL AND domain_status='verified')),
 CHECK(jsonb_typeof(dns_records)='array')
);
ALTER TABLE email_sending_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sending_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_sending_profile_scope ON email_sending_profiles;
CREATE POLICY email_sending_profile_scope ON email_sending_profiles
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
