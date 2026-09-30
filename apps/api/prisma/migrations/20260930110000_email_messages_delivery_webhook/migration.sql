-- Milestone 22, Task 5: Resend delivery webhooks (delivered / bounced / complained).
-- The webhook request has no tenant context: it finds a row by the provider message id. It runs
-- under a narrow 'email_webhook' role, same pattern as the Clock 'webhook_gateway' read
-- carve-out, limited to this table and only to reading and updating existing rows.

DROP POLICY IF EXISTS "email_messages_webhook_read" ON "email_messages";
CREATE POLICY "email_messages_webhook_read" ON "email_messages"
  FOR SELECT
  USING (current_setting('app.role', true) = 'email_webhook');

DROP POLICY IF EXISTS "email_messages_webhook_update" ON "email_messages";
CREATE POLICY "email_messages_webhook_update" ON "email_messages"
  FOR UPDATE
  USING (current_setting('app.role', true) = 'email_webhook')
  WITH CHECK (current_setting('app.role', true) = 'email_webhook');
