-- Milestone 21 Task 13: staff-defined priority order among a Clock-connected
-- room type's `wbe: true` rates. MUST stores only which of Clock's own rate
-- ids should win a conflict, and in what order -- never the rate data itself.

CREATE TABLE "clock_rate_rankings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "external_rate_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clock_rate_rankings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clock_rate_rankings_room_type_fkey"
      FOREIGN KEY ("tenant_id", "property_id", "room_type_id") REFERENCES "room_types"("tenant_id", "property_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clock_rate_rankings_rate_unique" UNIQUE ("tenant_id", "room_type_id", "external_rate_id"),
    CONSTRAINT "clock_rate_rankings_rank_unique" UNIQUE ("tenant_id", "room_type_id", "rank")
);

CREATE INDEX "clock_rate_rankings_tenant_id_property_id_idx"
  ON "clock_rate_rankings"("tenant_id", "property_id");

ALTER TABLE "clock_rate_rankings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clock_rate_rankings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clock_rate_rankings_tenant_isolation" ON "clock_rate_rankings";
CREATE POLICY "clock_rate_rankings_tenant_isolation" ON "clock_rate_rankings"
  USING (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  )
  WITH CHECK (
    "tenant_id" = "app_current_tenant_id"()
    AND ("app_current_property_id"() IS NULL OR "property_id" = "app_current_property_id"())
  );
