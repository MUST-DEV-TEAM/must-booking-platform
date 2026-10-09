-- Email plan Step 1 (Milestone 22 Phase C): per property, who receives each
-- notification. A property with no settings row for a topic keeps today's
-- behaviour (guest emailed; staff = assigned staff, else owners/admins), so this
-- migration changes nothing until a hotel saves its own choice. Additive only.

CREATE TYPE "NotificationRecipientTarget" AS ENUM (
  'MEMBERSHIP_ROLE', 'ROLE_TEMPLATE', 'STAFF_USER', 'EMAIL'
);

CREATE TABLE IF NOT EXISTS "notification_topic_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "topic" VARCHAR(80) NOT NULL,
  "guest_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  -- FALSE: staff recipients follow the built-in default. TRUE: only the rules below.
  "custom_staff_recipients" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_topic_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_topic_settings_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_topic_settings_property_topic_key"
  ON "notification_topic_settings"("tenant_id", "property_id", "topic");

CREATE TABLE IF NOT EXISTS "notification_recipient_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "topic" VARCHAR(80) NOT NULL,
  "target" "NotificationRecipientTarget" NOT NULL,
  "membership_role" "TenantMembershipRole",
  "role_template_id" UUID,
  "user_id" UUID,
  "email" VARCHAR(320),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_recipient_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_recipient_rules_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "notification_recipient_rules_role_template_fkey"
    FOREIGN KEY ("tenant_id", "property_id", "role_template_id")
    REFERENCES "property_role_templates"("tenant_id", "property_id", "id") ON DELETE CASCADE,
  CONSTRAINT "notification_recipient_rules_membership_fkey"
    FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE CASCADE,
  -- Exactly the one column its target names is set.
  CONSTRAINT "notification_recipient_rules_target_check" CHECK (
    ("target" = 'MEMBERSHIP_ROLE') = ("membership_role" IS NOT NULL)
    AND ("target" = 'ROLE_TEMPLATE') = ("role_template_id" IS NOT NULL)
    AND ("target" = 'STAFF_USER') = ("user_id" IS NOT NULL)
    AND ("target" = 'EMAIL') = ("email" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "notification_recipient_rules_property_topic_idx"
  ON "notification_recipient_rules"("tenant_id", "property_id", "topic");

ALTER TABLE "notification_topic_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_topic_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_topic_settings_isolation" ON "notification_topic_settings";
CREATE POLICY "notification_topic_settings_isolation" ON "notification_topic_settings"
  USING ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()))
  WITH CHECK ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()));

ALTER TABLE "notification_recipient_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_recipient_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_recipient_rules_isolation" ON "notification_recipient_rules";
CREATE POLICY "notification_recipient_rules_isolation" ON "notification_recipient_rules"
  USING ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()))
  WITH CHECK ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()));
