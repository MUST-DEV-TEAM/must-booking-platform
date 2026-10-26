ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS preview_text varchar(200) NOT NULL DEFAULT '';
ALTER TABLE email_template_revisions ADD COLUMN IF NOT EXISTS preview_text varchar(200) NOT NULL DEFAULT '';
