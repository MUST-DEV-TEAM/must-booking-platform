import { describe, expect, it } from 'vitest';

import { accommodationCsv, parseAccommodationCsv } from './room-management-csv';

describe('accommodation CSV', () => {
  it('round-trips room types with stable IDs and editable fields', () => {
    const csv = accommodationCsv('room-types', [
      {
        id: 'type-1',
        name: 'Suite, sea view',
        description: 'Large "quiet" suite',
        amenitiesIntro: 'Coffee and tea',
        maxOccupancy: 3,
        status: 'DRAFT',
        categoryId: 'category-1',
        mainImageUrl: null,
        galleryImageUrls: [],
      },
    ]);
    expect(parseAccommodationCsv('room-types', csv)).toEqual([
      {
        id: 'type-1',
        name: 'Suite, sea view',
        description: 'Large "quiet" suite',
        amenitiesIntro: 'Coffee and tea',
        maxOccupancy: '3',
        status: 'DRAFT',
        categoryId: 'category-1',
      },
    ]);
  });

  it('parses quoted commas and line breaks, and rejects a formula-leading export value', () => {
    const csv = accommodationCsv('rooms', [
      {
        roomType: {
          id: 'type-1',
          name: 'Suite',
          description: null,
          amenitiesIntro: null,
          maxOccupancy: 2,
          status: 'PUBLISHED',
          mainImageUrl: null,
          galleryImageUrls: [],
        },
        room: {
          id: 'room-1',
          name: '101',
          title: 'A room',
          roomSize: null,
          rules: 'Keep calm, "please"\nand enjoy',
          description: '=HYPERLINK("x")',
          floor: 1,
          viewType: 'Sea view',
          isActive: true,
        },
      },
    ]);
    expect(csv).toContain('\'=HYPERLINK(""x"")');
    expect(parseAccommodationCsv('rooms', csv)[0]).toMatchObject({
      name: '101',
      rules: 'Keep calm, "please"\nand enjoy',
      description: '\'=HYPERLINK("x")',
    });
  });

  it('requires mandatory columns and reports malformed quoted values', () => {
    expect(() => parseAccommodationCsv('room-types', 'name,description\nSuite,Large')).toThrow(
      'maxoccupancy',
    );
    expect(() => parseAccommodationCsv('rooms', 'name,title\n101,"broken')).toThrow(
      'unclosed quoted',
    );
  });
});
