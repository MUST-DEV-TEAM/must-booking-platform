-- Milestone 2, Task 5: expose verification state without bypassing users RLS.
CREATE OR REPLACE FUNCTION "auth_get_user_by_id"(input_user_id UUID)
RETURNS TABLE (id UUID, email VARCHAR(320), email_verified_at TIMESTAMPTZ(6))
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.email, u.email_verified_at
  FROM public.users u
  WHERE u.id = input_user_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION "auth_get_user_by_id"(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_get_user_by_id"(UUID) TO must_booking_app;
