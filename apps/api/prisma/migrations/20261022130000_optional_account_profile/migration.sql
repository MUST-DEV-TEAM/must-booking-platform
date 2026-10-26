-- Additive optional global identity fields; hotel guest profiles remain separate.
-- Rollback: retain/export profile values, stop use of the two new functions, then owner-approved removal.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_country_code VARCHAR(5), ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20), ADD COLUMN IF NOT EXISTS birth_date DATE, ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(35), ADD COLUMN IF NOT EXISTS personal_timezone VARCHAR(100), ADD COLUMN IF NOT EXISTS job_title VARCHAR(100);
CREATE OR REPLACE FUNCTION auth_get_profile_details(input_user_id UUID) RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('phoneCountryCode',phone_country_code,'phoneNumber',phone_number,'birthDate',to_char(birth_date,'YYYY-MM-DD'),'preferredLanguage',preferred_language,'personalTimezone',personal_timezone,'jobTitle',job_title) FROM public.users WHERE id=input_user_id
$$;
CREATE OR REPLACE FUNCTION auth_update_profile_details(input_user_id UUID, patch JSONB) RETURNS VOID LANGUAGE SQL SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.users SET
 phone_country_code=CASE WHEN patch?'phoneCountryCode' THEN patch->>'phoneCountryCode' ELSE phone_country_code END,
 phone_number=CASE WHEN patch?'phoneNumber' THEN patch->>'phoneNumber' ELSE phone_number END,
 birth_date=CASE WHEN patch?'birthDate' THEN (patch->>'birthDate')::date ELSE birth_date END,
 preferred_language=CASE WHEN patch?'preferredLanguage' THEN patch->>'preferredLanguage' ELSE preferred_language END,
 personal_timezone=CASE WHEN patch?'personalTimezone' THEN patch->>'personalTimezone' ELSE personal_timezone END,
 job_title=CASE WHEN patch?'jobTitle' THEN patch->>'jobTitle' ELSE job_title END,
 updated_at=now() WHERE id=input_user_id
$$;
REVOKE ALL ON FUNCTION auth_get_profile_details(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_update_profile_details(UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_get_profile_details(UUID) TO must_booking_app;
GRANT EXECUTE ON FUNCTION auth_update_profile_details(UUID,JSONB) TO must_booking_app;
