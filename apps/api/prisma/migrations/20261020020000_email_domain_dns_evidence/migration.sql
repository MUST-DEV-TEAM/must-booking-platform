ALTER TABLE email_sending_profiles ADD COLUMN IF NOT EXISTS dmarc_evidence JSONB;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='email_sending_profiles'::regclass AND conname='email_sending_profile_dmarc_object') THEN
  ALTER TABLE email_sending_profiles ADD CONSTRAINT email_sending_profile_dmarc_object CHECK(dmarc_evidence IS NULL OR jsonb_typeof(dmarc_evidence)='object');
 END IF;
END $$;
