ALTER TABLE room_type_images
  ALTER COLUMN object_key DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS room_type_images_external_url_unique_idx
  ON room_type_images (tenant_id, property_id, room_type_id, source_url)
  WHERE source_url IS NOT NULL;

-- Existing URL-based room presentation is copied into the image collection.
-- Keep the legacy URL columns as a mirror for the existing public catalog contract.
WITH image_candidates AS (
  SELECT
    rt.tenant_id,
    rt.property_id,
    rt.id AS room_type_id,
    rt.main_image_url AS source_url,
    0::BIGINT AS position
  FROM room_types rt
  WHERE NULLIF(BTRIM(rt.main_image_url), '') IS NOT NULL

  UNION ALL

  SELECT
    rt.tenant_id,
    rt.property_id,
    rt.id AS room_type_id,
    urls.url AS source_url,
    urls.position + CASE WHEN NULLIF(BTRIM(rt.main_image_url), '') IS NULL THEN 0 ELSE 1 END
  FROM room_types rt
  CROSS JOIN LATERAL UNNEST(rt.gallery_image_urls) WITH ORDINALITY AS urls(url, position)
  WHERE NULLIF(BTRIM(urls.url), '') IS NOT NULL
    AND urls.url IS DISTINCT FROM rt.main_image_url
), deduplicated AS (
  SELECT DISTINCT ON (tenant_id, property_id, room_type_id, source_url)
    tenant_id, property_id, room_type_id, source_url, position
  FROM image_candidates
  ORDER BY tenant_id, property_id, room_type_id, source_url, position
), ordered_legacy_images AS (
  SELECT
    tenant_id,
    property_id,
    room_type_id,
    source_url,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, property_id, room_type_id
      ORDER BY position, source_url
    ) - 1 AS sort_order
  FROM deduplicated
)
INSERT INTO room_type_images (
  id, tenant_id, property_id, room_type_id, object_key, source_url, sort_order
)
SELECT
  gen_random_uuid(), tenant_id, property_id, room_type_id, NULL, source_url, sort_order::INTEGER
FROM ordered_legacy_images
ON CONFLICT (tenant_id, property_id, room_type_id, source_url) WHERE source_url IS NOT NULL
DO NOTHING;

-- Place any previously uploaded photos after the copied URL photos.
WITH legacy_counts AS (
  SELECT tenant_id, property_id, room_type_id, COUNT(*)::INTEGER AS image_count
  FROM room_type_images
  WHERE source_url IS NOT NULL
  GROUP BY tenant_id, property_id, room_type_id
), uploaded_order AS (
  SELECT
    images.id,
    COALESCE(legacy_counts.image_count, 0)
      + ROW_NUMBER() OVER (
          PARTITION BY images.tenant_id, images.property_id, images.room_type_id
          ORDER BY images.created_at, images.id
        ) - 1 AS sort_order
  FROM room_type_images images
  LEFT JOIN legacy_counts USING (tenant_id, property_id, room_type_id)
  WHERE images.object_key IS NOT NULL AND images.sort_order IS NULL
)
UPDATE room_type_images images
SET sort_order = uploaded_order.sort_order::INTEGER
FROM uploaded_order
WHERE images.id = uploaded_order.id AND images.sort_order IS NULL;

UPDATE room_type_images SET sort_order = 0 WHERE sort_order IS NULL;
ALTER TABLE room_type_images
  ALTER COLUMN sort_order SET DEFAULT 0,
  ALTER COLUMN sort_order SET NOT NULL;

ALTER TABLE room_type_images DROP CONSTRAINT IF EXISTS room_type_images_source_check;
ALTER TABLE room_type_images
  ADD CONSTRAINT room_type_images_source_check
    CHECK ((object_key IS NOT NULL) <> (source_url IS NOT NULL));

CREATE INDEX IF NOT EXISTS room_type_images_gallery_order_idx
  ON room_type_images (tenant_id, property_id, room_type_id, sort_order, created_at);

-- Rollback: the application keeps main_image_url/gallery_image_urls in sync with this ordered collection.
-- Run after reverting the application code:
-- DELETE FROM room_type_images WHERE source_url IS NOT NULL;
-- ALTER TABLE room_type_images DROP CONSTRAINT IF EXISTS room_type_images_source_check;
-- DROP INDEX IF EXISTS room_type_images_gallery_order_idx;
-- DROP INDEX IF EXISTS room_type_images_external_url_unique_idx;
-- ALTER TABLE room_type_images ALTER COLUMN object_key SET NOT NULL;
-- ALTER TABLE room_type_images DROP COLUMN IF EXISTS sort_order, DROP COLUMN IF EXISTS source_url;
