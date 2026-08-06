-- Per ADR-0027: tracks when a property's WordPress site last completed the
-- pairing-code connection flow, so the dashboard can show a real connected
-- state instead of assuming. Nullable — never connected is the default.
ALTER TABLE "properties" ADD COLUMN "wordpress_connected_at" TIMESTAMPTZ(6);
