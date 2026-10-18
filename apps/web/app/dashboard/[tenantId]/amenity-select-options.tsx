import { amenityIconCatalog } from './amenity-icon-catalog';
import type { Amenity, AmenityIcon } from './room-management-types';

export function amenitySelectOptions(amenities: Amenity[]) {
  return amenities.map((amenity) => {
    const Icon = amenity.icon ? amenityIconCatalog[amenity.icon].icon : null;
    return {
      value: amenity.id,
      label: amenity.name,
      icon: Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : undefined,
    };
  });
}

export const suggestedAmenityOptions = (
  [
    ['Hair dryer', 'HAIR_DRYER'],
    ['Kettle and coffee', 'KETTLE_COFFEE'],
    ['Minibar', 'MINIBAR'],
    ['Balcony', 'BALCONY'],
    ['Sea view', 'SEA_VIEW'],
    ['Safe', 'SAFE'],
    ['Bathrobe', 'BATHROBE'],
    ['Crib', 'CRIB'],
    ['Room service', 'ROOM_SERVICE'],
    ['Pets allowed', 'PETS_ALLOWED'],
    ['EV charging', 'EV_CHARGING'],
    ['Smart TV', 'SMART_TV'],
  ] satisfies Array<[string, AmenityIcon]>
).map(([label, key]) => {
  const Icon = amenityIconCatalog[key].icon;
  return { value: key, label, icon: <Icon aria-hidden="true" className="size-3.5 shrink-0" /> };
});
