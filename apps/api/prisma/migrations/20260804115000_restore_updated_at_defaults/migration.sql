-- The prior migration (20260804114000_repair_schema_drift) dropped the DB
-- default on guests.updated_at and integration_operations.updated_at,
-- following schema.prisma's diff at the time (both models declared
-- `@updatedAt` without `@default(now())`, unlike every other model in this
-- schema). That default is not cosmetic: LocalPmsProvider's raw-SQL INSERT
-- into integration_operations (and the raw-SQL guest-creation path) never
-- sets updated_at explicitly and relies on the DB default — dropping it
-- breaks booking creation with a NOT NULL violation. schema.prisma has been
-- fixed to match the rest of the schema's `@default(now()) @updatedAt`
-- pattern; this migration restores the actual database default to match.
ALTER TABLE "guests" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "integration_operations" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
