-- Terms and privacy: the hotel's links get numbered versions, and a booking records which versions the guest
-- accepted and when (gap G-56).
--
-- Additive only. A hotel that does nothing sees no change: acceptance is only required when the hotel switches
-- "Require acceptance at booking" on, and a guest who is not asked is recorded as not having accepted.
-- Rollback (nothing else refers to these):
--   ALTER TABLE bookings DROP COLUMN IF EXISTS terms_accepted_at, DROP COLUMN IF EXISTS terms_version_id,
--     DROP COLUMN IF EXISTS privacy_version_id;
--   DROP TRIGGER IF EXISTS property_legal_versions_track ON properties;
--   DROP FUNCTION IF EXISTS track_property_legal_versions();
--   DROP TABLE IF EXISTS property_legal_versions;
--   ALTER TABLE properties DROP COLUMN IF EXISTS privacy_url, DROP COLUMN IF EXISTS require_terms_acceptance;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS privacy_url varchar(2048),
  ADD COLUMN IF NOT EXISTS require_terms_acceptance boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS property_legal_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('TERMS', 'PRIVACY')),
  version integer NOT NULL CHECK (version >= 1),
  url varchar(2048) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, property_id, kind, version),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE property_legal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_legal_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON property_legal_versions;
CREATE POLICY tenant_scope ON property_legal_versions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT ON property_legal_versions TO must_booking_app;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version_id uuid REFERENCES property_legal_versions (id),
  ADD COLUMN IF NOT EXISTS privacy_version_id uuid REFERENCES property_legal_versions (id);

-- A new version whenever a link changes. The first change of a link that was already set also keeps the old
-- address as version 1, so a booking made before this change can still be explained.
CREATE OR REPLACE FUNCTION track_property_legal_versions() RETURNS trigger AS $$
DECLARE
  item record;
  latest integer;
  latest_url text;
  scope text;
BEGIN
  -- The row policy needs the hotel group in scope; keep whatever scope the caller had.
  scope := current_setting('app.tenant_id', true);
  PERFORM set_config('app.tenant_id', NEW.tenant_id::text, true);
  FOR item IN
    SELECT 'TERMS'::text AS kind, OLD.terms_url AS old_url, NEW.terms_url AS new_url
    UNION ALL
    SELECT 'PRIVACY', OLD.privacy_url, NEW.privacy_url
  LOOP
    IF item.new_url IS NULL OR item.new_url IS NOT DISTINCT FROM item.old_url THEN
      CONTINUE;
    END IF;
    SELECT version, url INTO latest, latest_url FROM property_legal_versions
      WHERE tenant_id = NEW.tenant_id AND property_id = NEW.id AND kind = item.kind
      ORDER BY version DESC LIMIT 1;
    IF latest IS NULL AND item.old_url IS NOT NULL THEN
      INSERT INTO property_legal_versions (tenant_id, property_id, kind, version, url)
        VALUES (NEW.tenant_id, NEW.id, item.kind, 1, item.old_url);
      latest := 1;
      latest_url := item.old_url;
    END IF;
    IF latest_url IS DISTINCT FROM item.new_url THEN
      INSERT INTO property_legal_versions (tenant_id, property_id, kind, version, url)
        VALUES (NEW.tenant_id, NEW.id, item.kind, COALESCE(latest, 0) + 1, item.new_url);
    END IF;
  END LOOP;
  IF scope IS NOT NULL AND scope <> '' THEN
    PERFORM set_config('app.tenant_id', scope, true);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS property_legal_versions_track ON properties;
CREATE TRIGGER property_legal_versions_track
  AFTER UPDATE OF terms_url, privacy_url ON properties
  FOR EACH ROW EXECUTE FUNCTION track_property_legal_versions();
