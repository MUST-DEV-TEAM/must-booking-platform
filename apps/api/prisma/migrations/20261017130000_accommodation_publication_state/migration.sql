DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'RoomTypeStatus' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "RoomTypeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN');
  END IF;
END $$;

ALTER TABLE room_types
  ADD COLUMN IF NOT EXISTS status "RoomTypeStatus" NOT NULL DEFAULT 'PUBLISHED';

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
