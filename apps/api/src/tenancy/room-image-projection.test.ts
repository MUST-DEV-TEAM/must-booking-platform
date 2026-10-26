import { describe, expect, it, vi } from 'vitest';

import { roomImagePresentation } from './room-image-projection';

const publicUrl = vi.fn((key: string) => `https://cdn.example.test/${key}`);

describe('roomImagePresentation', () => {
  it('uses ordered room images when the room has its own photos', () => {
    expect(
      roomImagePresentation(
        [
          {
            id: 'room-2',
            sourceUrl: 'https://images.example.test/room-2.jpg',
            objectKey: null,
            sortOrder: 1,
            isPrimary: false,
          },
          {
            id: 'room-1',
            sourceUrl: null,
            objectKey: 'rooms/primary.jpg',
            sortOrder: 0,
            isPrimary: true,
          },
        ],
        [
          {
            id: 'type-1',
            sourceUrl: 'https://images.example.test/type.jpg',
            objectKey: null,
            sortOrder: 0,
            isPrimary: true,
          },
        ],
        publicUrl,
      ),
    ).toEqual({
      images: [
        {
          id: 'room-1',
          url: 'https://cdn.example.test/rooms/primary.jpg',
          sortOrder: 0,
          isPrimary: true,
        },
        {
          id: 'room-2',
          url: 'https://images.example.test/room-2.jpg',
          sortOrder: 1,
          isPrimary: false,
        },
      ],
      photoSource: 'room',
    });
  });

  it('uses room type images when a room has no photos', () => {
    expect(
      roomImagePresentation(
        [],
        [
          {
            id: 'type-1',
            sourceUrl: 'https://images.example.test/type.jpg',
            objectKey: null,
            sortOrder: 0,
            isPrimary: true,
          },
        ],
        publicUrl,
      ),
    ).toEqual({
      images: [
        {
          id: 'type-1',
          url: 'https://images.example.test/type.jpg',
          sortOrder: 0,
          isPrimary: true,
        },
      ],
      photoSource: 'room_type',
    });
  });

  it('returns an empty presentation when neither the room nor its type has photos', () => {
    expect(roomImagePresentation([], [], publicUrl)).toEqual({ images: [], photoSource: 'none' });
  });
});
