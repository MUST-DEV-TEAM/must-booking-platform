CREATE TABLE IF NOT EXISTS "guests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "phone" VARCHAR(50),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guests_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "guests_tenant_id_id_key" UNIQUE ("tenant_id", "id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "guests_tenant_lower_email_key"
  ON "guests" ("tenant_id", lower("email"));

CREATE INDEX IF NOT EXISTS "guests_tenant_id_created_at_idx"
  ON "guests" ("tenant_id", "created_at" DESC);

ALTER TABLE "guests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "guests_tenant_isolation" ON "guests";
CREATE POLICY "guests_tenant_isolation" ON "guests"
  USING ("tenant_id" = "app_current_tenant_id"())
  WITH CHECK ("tenant_id" = "app_current_tenant_id"());

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_tenant_guest_fkey";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_tenant_guest_fkey"
  FOREIGN KEY ("tenant_id", "guest_id")
  REFERENCES "guests" ("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
