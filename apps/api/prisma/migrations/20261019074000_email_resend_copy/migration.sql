ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS resend_of_message_id UUID;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='email_message_resend_source') THEN
  ALTER TABLE email_messages ADD CONSTRAINT email_message_resend_source
   FOREIGN KEY(tenant_id,property_id,resend_of_message_id) REFERENCES email_messages(tenant_id,property_id,id)
   DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS email_message_resend_source_index ON email_messages(tenant_id,property_id,resend_of_message_id);
