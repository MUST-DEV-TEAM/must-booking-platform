-- A hotel can choose the local time each scheduled email may start going out (gap G-81). Empty keeps today's
-- fixed times: owner summaries from 07:00, pre-arrival from 09:00, post-stay from 10:00, in the hotel's time.
--
-- Additive: three nullable columns. Rollback:
--   ALTER TABLE properties DROP COLUMN IF EXISTS owner_summary_time, DROP COLUMN IF EXISTS pre_arrival_email_time,
--     DROP COLUMN IF EXISTS post_stay_email_time;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS owner_summary_time varchar(5),
  ADD COLUMN IF NOT EXISTS pre_arrival_email_time varchar(5),
  ADD COLUMN IF NOT EXISTS post_stay_email_time varchar(5);
