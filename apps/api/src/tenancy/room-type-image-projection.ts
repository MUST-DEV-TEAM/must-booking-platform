export type RoomTypeImageProjectionRow = {
  sourceUrl: string | null;
  objectKey: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt?: Date;
  id?: string;
};

/** Projects the canonical room_type_images collection into legacy URL response fields. */
export function roomTypeImagePresentation(
  rows: RoomTypeImageProjectionRow[],
  publicUrl: (objectKey: string) => string,
) {
  const ordered = [...rows].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0) ||
      (left.id ?? '').localeCompare(right.id ?? ''),
  );
  const urls = ordered.map((row) => row.sourceUrl ?? publicUrl(row.objectKey!));
  const primaryIndex = ordered.findIndex((row) => row.isPrimary);
  const coverIndex = primaryIndex >= 0 ? primaryIndex : 0;
  return {
    mainImageUrl: urls[coverIndex] ?? null,
    galleryImageUrls: urls.filter((_, index) => index !== coverIndex),
  };
}
