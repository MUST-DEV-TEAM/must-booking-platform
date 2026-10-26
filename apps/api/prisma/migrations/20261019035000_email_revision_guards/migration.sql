-- Revision zero preserves the live wording that existed before versioned authoring.
ALTER TABLE email_template_revisions DROP CONSTRAINT IF EXISTS email_template_revisions_revision_check;
ALTER TABLE email_template_revisions ADD CONSTRAINT email_template_revisions_revision_check CHECK(revision>=0);
CREATE OR REPLACE FUNCTION preserve_email_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Email revisions are immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS preserve_email_revision ON email_template_revisions;
CREATE TRIGGER preserve_email_revision BEFORE UPDATE ON email_template_revisions FOR EACH ROW EXECUTE FUNCTION preserve_email_revision();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='email_template_heads'::regclass AND conname='email_live_revision_fk') THEN
  ALTER TABLE email_template_heads ADD CONSTRAINT email_live_revision_fk FOREIGN KEY(tenant_id,property_id,template_key,language,live_revision) REFERENCES email_template_revisions(tenant_id,property_id,template_key,language,revision) DEFERRABLE INITIALLY DEFERRED;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='email_template_heads'::regclass AND conname='email_draft_revision_fk') THEN
  ALTER TABLE email_template_heads ADD CONSTRAINT email_draft_revision_fk FOREIGN KEY(tenant_id,property_id,template_key,language,draft_revision) REFERENCES email_template_revisions(tenant_id,property_id,template_key,language,revision) DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
