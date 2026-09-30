-- Milestone 22, Task 3: one row per intended email so delivery is observable.
-- Sends were fire-and-forget (errors only reached the log), so a missing email
-- left no trace. This table records who, which event, status and provider id.
-- Tasks 4-6 write to it; this migration is additive and creates no data.

CREATE TYPE "EmailMessageStatus" AS ENUM (
  'QUEUED', 'SENT', 'FAILED', 'DELIVERED', 'BOUNCED', 'COMPLAINED'
);
CREATE TYPE "EmailRecipientKind" AS ENUM ('TO', 'CC', 'BCC');

CREATE TABLE "email_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID,
    "booking_id" UUID,
    "event_type" VARCHAR(80) NOT NULL,
    "recipient_email" VARCHAR(320) NOT NULL,
    "recipient_kind" "EmailRecipientKind" NOT NULL DEFAULT 'TO',
    "subject" VARCHAR(500) NOT NULL,
    "template_version" INTEGER,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" VARCHAR(40),
    "provider_message_id" VARCHAR(200),
    "idempotency_key" VARCHAR(300) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(1000),
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_messages_tenant_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "email_messages_property_fkey"
      FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "email_messages_attempt_count_check" CHECK ("attempt_count" >= 0)
);

-- One row per logical send: the idempotency key doubles as the duplicate guard
-- for transports (e.g. SMTP) that have no provider-side idempotency.
CREATE UNIQUE INDEX "email_messages_tenant_idempotency_key"
  ON "email_messages"("tenant_id", "idempotency_key");
CREATE INDEX "email_messages_tenant_property_created_idx"
  ON "email_messages"("tenant_id", "property_id", "created_at" DESC);
CREATE INDEX "email_messages_tenant_booking_idx"
  ON "email_messages"("tenant_id", "booking_id") WHERE "booking_id" IS NOT NULL;
CREATE INDEX "email_messages_provider_message_id_idx"
  ON "email_messages"("provider_message_id") WHERE "provider_message_id" IS NOT NULL;

ALTER TABLE "email_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_messages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_messages_tenant_isolation" ON "email_messages";
CREATE POLICY "email_messages_tenant_isolation" ON "email_messages"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
DROP POLICY IF EXISTS "email_messages_platform_admin_read" ON "email_messages";
CREATE POLICY "email_messages_platform_admin_read" ON "email_messages"
  FOR SELECT
  USING (current_setting('app.role', true) = 'platform_admin');
