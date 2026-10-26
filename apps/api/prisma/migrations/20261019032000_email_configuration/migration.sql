ALTER TABLE properties ADD COLUMN IF NOT EXISTS email_configuration_version INTEGER NOT NULL DEFAULT 1 CHECK(email_configuration_version>0);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS email_sender_name VARCHAR(120);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS email_reply_to VARCHAR(254);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS email_default_language TEXT NOT NULL DEFAULT 'en' CHECK(email_default_language IN ('en','sq'));
