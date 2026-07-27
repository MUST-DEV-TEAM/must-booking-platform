-- Milestone 1, Task 3: password credentials live only as bcrypt hashes.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMPTZ(6);

CREATE OR REPLACE FUNCTION "auth_get_user_by_email"(input_email TEXT)
RETURNS TABLE (id UUID, email VARCHAR(320), password_hash TEXT, email_verified_at TIMESTAMPTZ(6))
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.email, u.password_hash, u.email_verified_at
  FROM public.users u
  WHERE lower(u.email) = lower(input_email)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION "auth_update_password"(input_user_id UUID, input_password_hash TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.users
  SET password_hash = input_password_hash, updated_at = CURRENT_TIMESTAMP
  WHERE id = input_user_id;
$$;

CREATE OR REPLACE FUNCTION "auth_mark_email_verified"(input_user_id UUID)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.users
  SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
  WHERE id = input_user_id;
$$;

REVOKE ALL ON FUNCTION "auth_get_user_by_email"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "auth_update_password"(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "auth_mark_email_verified"(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_get_user_by_email"(TEXT) TO must_booking_app;
GRANT EXECUTE ON FUNCTION "auth_update_password"(UUID, TEXT) TO must_booking_app;
GRANT EXECUTE ON FUNCTION "auth_mark_email_verified"(UUID) TO must_booking_app;
