-- Staff invitations get a database record (gap G-85): a list of who was invited and what became of it, and the
-- ability to resend or withdraw one. The one-use secret link itself still lives in Redis for 7 days; this table
-- never holds the link, only its hash.
--
-- Additive only. Rollback (nothing else refers to this table):
--   DROP TABLE IF EXISTS staff_invitations;

CREATE TABLE IF NOT EXISTS staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  token_hash varchar(64) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'WITHDRAWN')),
  command jsonb NOT NULL,
  invited_by_user_id uuid,
  expires_at timestamptz NOT NULL,
  resent_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_invitations_tenant_created_idx
  ON staff_invitations (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitations_token_hash_idx ON staff_invitations (token_hash);

ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON staff_invitations;
CREATE POLICY tenant_scope ON staff_invitations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON staff_invitations TO must_booking_app;
