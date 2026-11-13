-- Milestone 38, task 5: query statistics.
-- The library is preloaded by the postgres service command (compose.homelab.yaml). Without the
-- preload this still succeeds; only reading the view then fails, which nothing in the app does.
-- Not for must_booking_app: the statistics are read by an operator as the owner role. The
-- extension grants its views to PUBLIC, and the schema's default privileges give the app role
-- rights on every new relation in public, so both grants are taken back.
-- Idempotent.
--
-- Rollback: DROP EXTENSION IF EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON pg_stat_statements, pg_stat_statements_info FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'must_booking_app') THEN
    REVOKE ALL ON pg_stat_statements, pg_stat_statements_info FROM must_booking_app;
  END IF;
END
$$;
REVOKE EXECUTE ON FUNCTION pg_stat_statements(boolean), pg_stat_statements_info() FROM PUBLIC;
