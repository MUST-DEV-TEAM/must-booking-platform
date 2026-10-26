ALTER TABLE tenant_memberships ADD COLUMN IF NOT EXISTS email_preferences_version INTEGER NOT NULL DEFAULT 1 CHECK(email_preferences_version>0);
