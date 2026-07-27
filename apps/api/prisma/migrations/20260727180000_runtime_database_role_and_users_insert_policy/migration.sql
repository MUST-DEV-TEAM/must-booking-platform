-- Milestone 1, Task 2 follow-up: the API must not run as the migration owner,
-- because table owners and superusers bypass row-level security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'must_booking_app') THEN
    CREATE ROLE must_booking_app
      LOGIN
      PASSWORD 'must_booking_app_dev'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  ELSE
    ALTER ROLE must_booking_app
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO must_booking_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO must_booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO must_booking_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO must_booking_app;

-- This migration is run by the dedicated migration owner (`must_booking`).
-- Its future tables and sequences must be available to the runtime role too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO must_booking_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO must_booking_app;

-- `users` has no tenant_id; tenant isolation begins when a membership is created.
-- Signup must be able to create a user before it can create that membership.
DROP POLICY IF EXISTS "users_deny_insert" ON "users";
CREATE POLICY "users_insert_allowed" ON "users"
  FOR INSERT
  WITH CHECK (true);
