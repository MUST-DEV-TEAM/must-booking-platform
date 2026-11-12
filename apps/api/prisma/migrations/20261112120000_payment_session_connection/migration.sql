-- Every payment session remembers the hotel's payment connection (account) that created it, so payment checks
-- and refunds always go to the account that took the money, even after the hotel switches between its test
-- (staging) and live (production) accounts. Additive and safe to re-run.
-- Rollback: ALTER TABLE "payment_provider_sessions" DROP CONSTRAINT IF EXISTS "payment_provider_sessions_connection_fkey";
--           ALTER TABLE "payment_provider_sessions" DROP COLUMN IF EXISTS "connection_id";
ALTER TABLE "payment_provider_sessions" ADD COLUMN IF NOT EXISTS "connection_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_provider_sessions_connection_fkey'
  ) THEN
    -- A connection can only be deleted when no payment used it; its expired, unpaid sessions then simply
    -- lose the link instead of blocking the delete.
    ALTER TABLE "payment_provider_sessions"
      ADD CONSTRAINT "payment_provider_sessions_connection_fkey"
      FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "integration_connections"("tenant_id", "id")
      ON DELETE SET NULL ("connection_id");
  END IF;
END $$;

-- Sessions created before this change: when the hotel has only ever had one connection of that provider,
-- it is certainly the one that took the payment. Otherwise the API finds the right account the first
-- time it needs it (it asks each of the hotel's accounts for the order) and records it then.
UPDATE "payment_provider_sessions" s
SET "connection_id" = single."connection_id"
FROM (
  SELECT pc."tenant_id", pc."property_id", lower(ic."provider"::text) AS "provider",
    (array_agg(ic."id"))[1] AS "connection_id"
  FROM "property_integration_connections" pc
  JOIN "integration_connections" ic ON ic."tenant_id" = pc."tenant_id" AND ic."id" = pc."connection_id"
  WHERE ic."kind" = 'PAYMENT'
  GROUP BY pc."tenant_id", pc."property_id", lower(ic."provider"::text)
  HAVING count(*) = 1
) single
WHERE s."connection_id" IS NULL
  AND s."tenant_id" = single."tenant_id"
  AND s."property_id" = single."property_id"
  AND s."provider" = single."provider";
