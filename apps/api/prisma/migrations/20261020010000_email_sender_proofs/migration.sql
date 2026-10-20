CREATE TABLE IF NOT EXISTS email_sender_proofs (
 tenant_id UUID NOT NULL, property_id UUID NOT NULL, id UUID NOT NULL,
 credential_revision UUID NOT NULL, from_address TEXT NOT NULL,
 code_hash CHAR(64), encrypted_message TEXT, transport_fingerprint CHAR(64) NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','verified','superseded','expired','locked')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 guess_fingerprints TEXT[] NOT NULL DEFAULT '{}' CHECK(cardinality(guess_fingerprints)<=5),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
 verified_at TIMESTAMPTZ, verified_by UUID,
 PRIMARY KEY(tenant_id,property_id,id),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE CASCADE,
 CHECK(expires_at>created_at),
 CHECK(state='pending' OR (code_hash IS NULL AND encrypted_message IS NULL))
);
CREATE INDEX IF NOT EXISTS email_sender_proofs_recent ON email_sender_proofs(tenant_id,property_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS email_sender_proofs_pending ON email_sender_proofs(tenant_id,property_id) WHERE state='pending';
ALTER TABLE email_sender_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sender_proofs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_sender_proof_scope ON email_sender_proofs;
CREATE POLICY email_sender_proof_scope ON email_sender_proofs
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
