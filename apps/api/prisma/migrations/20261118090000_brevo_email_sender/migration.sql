-- A hotel can send its email through its own Brevo account (Brevo transactional API).
-- Brevo works like SMTP for safety: the From mailbox is verified by MUST and the saved
-- API key passes a connection check before the sender can be activated.
-- Additive and safe to re-run. Rollback (only while no row uses BREVO/brevo):
--   restore the three CHECKs without 'BREVO'/'brevo' and drop email_sending_profile_brevo_active.
ALTER TABLE email_sending_profiles DROP CONSTRAINT IF EXISTS email_sending_profiles_mode_check;
ALTER TABLE email_sending_profiles ADD CONSTRAINT email_sending_profiles_mode_check
  CHECK (mode IN ('DEFAULT','RESEND','SMTP','BREVO'));
ALTER TABLE email_sending_profiles DROP CONSTRAINT IF EXISTS email_sending_profiles_active_mode_check;
ALTER TABLE email_sending_profiles ADD CONSTRAINT email_sending_profiles_active_mode_check
  CHECK (active_mode IN ('DEFAULT','RESEND','SMTP','BREVO'));
ALTER TABLE email_sending_profiles DROP CONSTRAINT IF EXISTS email_sending_profile_brevo_active;
ALTER TABLE email_sending_profiles ADD CONSTRAINT email_sending_profile_brevo_active
  CHECK (active_mode <> 'BREVO' OR (from_verified_at IS NOT NULL AND connection_checked_at IS NOT NULL));
ALTER TABLE email_transport_attempts DROP CONSTRAINT IF EXISTS email_transport_attempts_provider_check;
ALTER TABLE email_transport_attempts ADD CONSTRAINT email_transport_attempts_provider_check
  CHECK (provider IN ('resend','smtp','brevo'));
