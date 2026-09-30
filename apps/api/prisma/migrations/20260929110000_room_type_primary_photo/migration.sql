-- A room type may have one explicitly selected primary photo. Existing galleries
-- keep their current cover by promoting the first photo in display order.
ALTER TABLE room_type_images
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

WITH ranked_images AS (
  SELECT
    id,
    tenant_id,
    property_id,
    room_type_id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, property_id, room_type_id
      ORDER BY sort_order, created_at, id
    ) AS position
  FROM room_type_images
)
UPDATE room_type_images AS image
SET is_primary = true
FROM ranked_images AS ranked
WHERE image.id = ranked.id
  AND ranked.position = 1
  AND NOT EXISTS (
    SELECT 1
    FROM room_type_images AS current_primary
    WHERE current_primary.tenant_id = ranked.tenant_id
      AND current_primary.property_id = ranked.property_id
      AND current_primary.room_type_id = ranked.room_type_id
      AND current_primary.is_primary = true
  );

CREATE UNIQUE INDEX IF NOT EXISTS room_type_images_single_primary_idx
  ON room_type_images (tenant_id, property_id, room_type_id)
  WHERE is_primary = true;

-- Rollback:
-- DROP INDEX IF EXISTS room_type_images_single_primary_idx;
-- ALTER TABLE room_type_images DROP COLUMN IF EXISTS is_primary;
