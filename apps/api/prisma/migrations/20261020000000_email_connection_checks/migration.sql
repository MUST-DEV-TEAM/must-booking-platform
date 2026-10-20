-- Additive evidence only. Existing rows remain pending/default; no sender is activated.
ALTER TABLE email_sending_profiles
 ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'unknown',
 ADD COLUMN IF NOT EXISTS connection_operation_id UUID,
 ADD COLUMN IF NOT EXISTS connection_expires_at TIMESTAMPTZ;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='email_sending_profiles'::regclass AND conname='email_connection_check_state') THEN
  ALTER TABLE email_sending_profiles ADD CONSTRAINT email_connection_check_state CHECK (
   connection_status IN ('unknown','checking','verified','failed') AND
   (connection_status<>'checking' OR (connection_operation_id IS NOT NULL AND connection_expires_at IS NOT NULL)) AND
   (connection_status<>'verified' OR connection_checked_at IS NOT NULL)
  );
 END IF;
END $$;
-- Existing FORCE RLS and exact tenant/property policy continue to cover all columns.
