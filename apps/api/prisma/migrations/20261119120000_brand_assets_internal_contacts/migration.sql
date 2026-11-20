-- Settings redesign, Contact and brand (S3c): the brand image set and the internal contacts.
-- Additive; nothing reads them until the booking page, emails and website connection are switched over.
-- logo_dark_url: logo for dark backgrounds. icon_url: square icon. favicon_url: replaces the favicon made
-- from the icon (null = use the icon). cover_url: the cover photo. The internal contacts are for MUST and
-- the hotel's accountant, never shown to guests.
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS logo_dark_url varchar(2048);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS icon_url varchar(2048);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS favicon_url varchar(2048);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS cover_url varchar(2048);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS accounting_email varchar(254);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS main_contact_name varchar(120);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS main_contact_role varchar(120);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS main_contact_phone varchar(20);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS main_contact_email varchar(254);
