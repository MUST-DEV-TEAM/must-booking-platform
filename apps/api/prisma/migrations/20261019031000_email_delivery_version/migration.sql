ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS workspace_version INTEGER NOT NULL DEFAULT 1 CHECK(workspace_version>0);
