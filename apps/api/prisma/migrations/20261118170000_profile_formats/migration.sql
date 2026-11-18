-- Hotel display formats (settings redesign S2c). Stored only; nothing reads them yet.
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS time_format varchar(3) NOT NULL DEFAULT '24h' CHECK (time_format IN ('24h', '12h'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS week_start varchar(6) NOT NULL DEFAULT 'monday' CHECK (week_start IN ('monday', 'sunday'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS number_format varchar(10) NOT NULL DEFAULT 'comma_dot' CHECK (number_format IN ('comma_dot', 'dot_comma'));
