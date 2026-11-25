-- Booking window, season and arrival/departure days (settings redesign S4a).
-- Defaults keep today's behaviour: no notice, open all year, every weekday allowed.
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS min_notice_hours integer CHECK (min_notice_hours IS NULL OR min_notice_hours BETWEEN 0 AND 720);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS season_open_from varchar(5) CHECK (season_open_from IS NULL OR season_open_from ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
ALTER TABLE properties ADD COLUMN IF NOT EXISTS season_open_to varchar(5) CHECK (season_open_to IS NULL OR season_open_to ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
ALTER TABLE properties ADD COLUMN IF NOT EXISTS arrival_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS departure_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}';
