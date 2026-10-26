-- Additive email authoring evidence. Application-first rollback; retain revisions.
CREATE TABLE IF NOT EXISTS email_workspace_operations (
 tenant_id UUID NOT NULL, property_id UUID NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL,response JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,idempotency_key),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS email_template_heads (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,template_key TEXT NOT NULL,language TEXT NOT NULL CHECK(language IN ('en','sq')),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),live_revision INTEGER,draft_revision INTEGER,
 PRIMARY KEY(tenant_id,property_id,template_key,language),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS email_template_revisions (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,template_key TEXT NOT NULL,language TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),subject VARCHAR(300) NOT NULL,body TEXT NOT NULL CHECK(length(body)<=5000),
 actor_user_id UUID NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,template_key,language,revision),
 FOREIGN KEY(tenant_id,property_id,template_key,language) REFERENCES email_template_heads(tenant_id,property_id,template_key,language) ON DELETE CASCADE
);
DO $$ DECLARE tab TEXT; BEGIN FOREACH tab IN ARRAY ARRAY['email_workspace_operations','email_template_heads','email_template_revisions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('DROP POLICY IF EXISTS email_workspace_scope ON %I',tab);
 EXECUTE format('CREATE POLICY email_workspace_scope ON %I USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())',tab);
 END LOOP; END $$;
