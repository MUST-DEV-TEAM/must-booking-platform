import type { AvailabilityGridCell } from '../../components/ui/availability-grid';
export type InventoryPrefill = {
  startsOn: string;
  endsOn: string;
  roomTypeIds: string[];
  targetIds: string[];
  scope: 'room_type' | 'targets';
  all: false;
  type?: string;
};
/** A create dialog represents one contiguous range across the selected room types; dates are calendar days. */
export function inventorySelection(
  cells: readonly AvailabilityGridCell[],
  kind: 'restrictions' | 'blocks',
): InventoryPrefill | null {
  if (!cells.length) return null;
  const dates = cells.map((c) => c.date).sort(),
    types = [...new Set(cells.map((c) => c.rowId))].sort();
  const last = dates.at(-1)!;
  return {
    startsOn: dates[0]!,
    endsOn:
      kind === 'restrictions'
        ? last
        : new Date(Date.parse(last) + 86400000).toISOString().slice(0, 10),
    roomTypeIds: types,
    targetIds: types,
    scope: kind === 'restrictions' ? 'room_type' : 'targets',
    all: false,
    ...(kind === 'restrictions' ? { type: 'stop_sell' } : {}),
  };
}
