export type RoomImageProjectionRow = {
  id: string;
  sourceUrl: string | null;
  objectKey: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt?: Date | string;
};

export type RoomImageView = {
  id: string;
  url: string;
  sortOrder: number;
  isPrimary: boolean;
};

/** Uses a room's own ordered images when present, otherwise the assigned room type's images. */
export function roomImagePresentation(
  roomImages: RoomImageProjectionRow[],
  roomTypeImages: RoomImageProjectionRow[],
  publicUrl: (objectKey: string) => string,
): { images: RoomImageView[]; photoSource: 'room' | 'room_type' | 'none' } {
  const ownsImages = roomImages.length > 0;
  const selected = ownsImages ? roomImages : roomTypeImages;
  const ordered = [...selected].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      (left.createdAt ? new Date(left.createdAt).getTime() : 0) -
        (right.createdAt ? new Date(right.createdAt).getTime() : 0) ||
      left.id.localeCompare(right.id),
  );
  return {
    images: ordered.map((image) => ({
      id: image.id,
      url: image.sourceUrl ?? publicUrl(image.objectKey!),
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),
    photoSource: ownsImages ? 'room' : roomTypeImages.length ? 'room_type' : 'none',
  };
}
