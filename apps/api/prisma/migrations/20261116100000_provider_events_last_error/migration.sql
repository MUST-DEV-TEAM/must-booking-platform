-- Keeps why the last attempt to process a webhook event failed (error name, code and a masked first line of the
-- message, at most 300 characters), so staff can tell a timeout from a refused row. Written on every failed attempt;
-- left as history when the event later succeeds.
-- Additive and idempotent. Roll back with: ALTER TABLE provider_events DROP COLUMN IF EXISTS last_error;
-- (the previous application never reads it).
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS last_error varchar(300);
