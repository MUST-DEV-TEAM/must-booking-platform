import { describe, expect, it } from 'vitest';

import { roomTypeImagePresentation } from './room-type-image-projection';

describe('roomTypeImagePresentation', () => {
  it('projects the selected primary and ordered gallery from the image collection', () => {
    expect(
      roomTypeImagePresentation(
        [
          {
            sourceUrl: 'https://images.example.test/gallery.jpg',
            objectKey: null,
            sortOrder: 0,
            isPrimary: false,
          },
          {
            sourceUrl: 'https://images.example.test/cover.jpg',
            objectKey: null,
            sortOrder: 1,
            isPrimary: true,
          },
        ],
        (key) => `https://cdn.example.test/${key}`,
      ),
    ).toEqual({
      mainImageUrl: 'https://images.example.test/cover.jpg',
      galleryImageUrls: ['https://images.example.test/gallery.jpg'],
    });
  });

  it('uses the first ordered image as the cover when no primary is marked', () => {
    expect(
      roomTypeImagePresentation(
        [
          {
            sourceUrl: null,
            objectKey: 'rooms/second.jpg',
            sortOrder: 1,
            isPrimary: false,
          },
          {
            sourceUrl: null,
            objectKey: 'rooms/first.jpg',
            sortOrder: 0,
            isPrimary: false,
          },
        ],
        (key) => `https://cdn.example.test/${key}`,
      ),
    ).toEqual({
      mainImageUrl: 'https://cdn.example.test/rooms/first.jpg',
      galleryImageUrls: ['https://cdn.example.test/rooms/second.jpg'],
    });
  });

  it('returns empty compatibility fields for an empty collection', () => {
    expect(roomTypeImagePresentation([], (key) => key)).toEqual({
      mainImageUrl: null,
      galleryImageUrls: [],
    });
  });
});
