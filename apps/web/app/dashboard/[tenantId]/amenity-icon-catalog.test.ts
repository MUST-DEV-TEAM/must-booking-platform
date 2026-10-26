import { describe, expect, it } from 'vitest';

import { amenityIconCatalog, amenityIcons } from './amenity-icon-catalog';

describe('amenity icon catalog', () => {
  it('maps every curated amenity key to a labeled lucide icon', () => {
    expect(amenityIcons).toHaveLength(54);
    for (const key of amenityIcons) {
      expect(amenityIconCatalog[key].label).toBeTruthy();
      expect(amenityIconCatalog[key].icon).toBeDefined();
    }
    expect(amenityIconCatalog.HAIR_DRYER.label).toBe('Hair dryer');
    expect(amenityIconCatalog.BEACH_ACCESS.icon).toBe(amenityIconCatalog.BEACH.icon);
  });
});
