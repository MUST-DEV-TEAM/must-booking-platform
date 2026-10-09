-- Email plan Step 1 follow-up: each staff member can mute the non-urgent staff emails
-- (daily summary, refund made) for themselves. Urgent ones (new booking,
-- cancellation, problem alerts) always go out. Additive.
ALTER TABLE "tenant_memberships"
  ADD COLUMN IF NOT EXISTS "mute_optional_emails" BOOLEAN NOT NULL DEFAULT FALSE;
