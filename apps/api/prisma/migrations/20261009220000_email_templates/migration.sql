-- Email plan Step 3: a property's own wording for its guest emails. Each row
-- replaces the default subject and message of one email in one language; the
-- branded header, booking details and footer stay generated. No row = default.
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "template_key" VARCHAR(80) NOT NULL,
  "language" VARCHAR(10) NOT NULL DEFAULT 'en',
  "subject" VARCHAR(300) NOT NULL,
  "body" TEXT NOT NULL,
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_templates_property_fkey"
    FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "email_templates_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 5000)
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_property_key_language_key"
  ON "email_templates"("tenant_id", "property_id", "template_key", "language");

ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_templates_isolation" ON "email_templates";
CREATE POLICY "email_templates_isolation" ON "email_templates"
  USING ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()))
  WITH CHECK ("tenant_id" = "app_current_tenant_id"() AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"()));
