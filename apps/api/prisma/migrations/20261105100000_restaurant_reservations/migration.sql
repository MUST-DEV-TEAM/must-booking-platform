-- Restaurant table reservations: a booking for a party at a time, the table(s) it uses, and a
-- history of status changes. Additive and re-runnable.

CREATE TABLE IF NOT EXISTS "venue_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "venue_id" UUID NOT NULL,
  "reference" VARCHAR(12) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'confirmed'
    CHECK ("status" IN ('pending_payment', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6) NOT NULL,
  "party_size" INTEGER NOT NULL CHECK ("party_size" BETWEEN 1 AND 500),
  "guest_name" VARCHAR(200) NOT NULL,
  "guest_phone" VARCHAR(50),
  "guest_email" VARCHAR(320),
  "guest_id" UUID,
  "notes" VARCHAR(1000),
  "source" VARCHAR(20) NOT NULL DEFAULT 'staff'
    CHECK ("source" IN ('staff', 'phone', 'walk_in', 'whatsapp', 'word_of_mouth', 'website', 'api')),
  "created_by_user_id" UUID,
  "seated_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venue_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venue_reservations_times_check" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "venue_reservations_tenant_venue_id_key" UNIQUE ("tenant_id", "venue_id", "id"),
  CONSTRAINT "venue_reservations_tenant_reference_key" UNIQUE ("tenant_id", "reference"),
  CONSTRAINT "venue_reservations_venue_fkey"
    FOREIGN KEY ("tenant_id", "venue_id") REFERENCES "venues"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "venue_reservations_guest_fkey"
    FOREIGN KEY ("tenant_id", "guest_id") REFERENCES "guests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "venue_reservations_venue_time_idx"
  ON "venue_reservations"("tenant_id", "venue_id", "starts_at");
CREATE INDEX IF NOT EXISTS "venue_reservations_guest_idx"
  ON "venue_reservations"("tenant_id", "guest_id") WHERE "guest_id" IS NOT NULL;

-- The table (or tables, for a party that pushes tables together) a reservation uses.
CREATE TABLE IF NOT EXISTS "venue_reservation_tables" (
  "tenant_id" UUID NOT NULL,
  "venue_id" UUID NOT NULL,
  "reservation_id" UUID NOT NULL,
  "table_id" UUID NOT NULL,
  CONSTRAINT "venue_reservation_tables_pkey" PRIMARY KEY ("tenant_id", "reservation_id", "table_id"),
  CONSTRAINT "venue_reservation_tables_reservation_fkey"
    FOREIGN KEY ("tenant_id", "venue_id", "reservation_id") REFERENCES "venue_reservations"("tenant_id", "venue_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "venue_reservation_tables_table_fkey"
    FOREIGN KEY ("tenant_id", "venue_id", "table_id") REFERENCES "venue_tables"("tenant_id", "venue_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "venue_reservation_tables_table_idx"
  ON "venue_reservation_tables"("tenant_id", "venue_id", "table_id");

-- Every status change, so a booking's history is never lost.
CREATE TABLE IF NOT EXISTS "venue_reservation_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "venue_id" UUID NOT NULL,
  "reservation_id" UUID NOT NULL,
  "from_status" VARCHAR(16),
  "to_status" VARCHAR(16) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_user_id" UUID,
  "note" VARCHAR(500),
  CONSTRAINT "venue_reservation_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venue_reservation_events_reservation_fkey"
    FOREIGN KEY ("tenant_id", "venue_id", "reservation_id") REFERENCES "venue_reservations"("tenant_id", "venue_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "venue_reservation_events_reservation_idx"
  ON "venue_reservation_events"("tenant_id", "venue_id", "reservation_id", "occurred_at");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['venue_reservations', 'venue_reservation_tables', 'venue_reservation_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

-- The history is append-only for the application role.
REVOKE UPDATE, DELETE ON "venue_reservation_events" FROM must_booking_app;
GRANT SELECT, INSERT ON "venue_reservation_events" TO must_booking_app;
