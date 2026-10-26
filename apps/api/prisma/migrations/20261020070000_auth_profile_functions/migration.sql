-- Own-profile name read/update through the same SECURITY DEFINER boundary as the other auth functions.
CREATE OR REPLACE FUNCTION "auth_get_profile"(input_user_id UUID)
RETURNS TABLE(first_name VARCHAR, last_name VARCHAR)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.first_name, u.last_name FROM public.users u WHERE u.id = input_user_id;
$$;
CREATE OR REPLACE FUNCTION "auth_update_profile"(input_user_id UUID, input_first_name TEXT, input_last_name TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.users
  SET first_name = input_first_name, last_name = input_last_name, updated_at = CURRENT_TIMESTAMP
  WHERE id = input_user_id;
$$;
REVOKE ALL ON FUNCTION "auth_get_profile"(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION "auth_update_profile"(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_get_profile"(UUID) TO must_booking_app;
GRANT EXECUTE ON FUNCTION "auth_update_profile"(UUID, TEXT, TEXT) TO must_booking_app;
-- Rollback: DROP FUNCTION "auth_get_profile"(UUID); DROP FUNCTION "auth_update_profile"(UUID, TEXT, TEXT);
