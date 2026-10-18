export type InventoryConflict = {
  id: string;
  kind?: string;
  name?: string;
  reference?: string;
  date?: string;
  startsOn?: string;
  endsOn?: string;
};
export type InventoryRecord = {
  id: string;
  reference: string | null;
  name?: string;
  title?: string;
  type?: string;
  value?: number;
  scope?: string;
  targetIds?: string[];
  startsOn: string;
  endsOn: string | null;
  weekdays?: number[];
  priority?: number;
  lifecycle: string;
  internalReason?: string;
  version: number;
  validation?: string;
  conflicts?: InventoryConflict[];
  updatedAt?: string;
  createdAt?: string;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdByEmail?: string | null;
  inventoryReference?: string | null;
  all?: boolean;
  roomTypeIds?: string[];
  roomIds?: string[];
  reason?: string;
  note?: string;
  responsibleStaffId?: string | null;
  endReason?: string | null;
  scopeLocked?: boolean;
  endingSoon?: boolean;
};
export type InventoryList = {
  source: 'LOCAL' | 'CLOCK_PMS';
  readOnly: boolean;
  today: string;
  timezone: string;
  bookingMode?: string;
  items: InventoryRecord[];
  baseRestrictions?: { id: string; type: string; value: number }[];
};
export type CatalogItem = { id: string; name: string; status?: string; roomTypeId?: string };
export type StaffChoice = {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status?: string;
  suspendedAt?: string | null;
};
export type InventoryOverview = {
  source: string;
  readOnly: boolean;
  today: string;
  timezone: string;
  endsOn: string;
  activeRestrictions: number | null;
  activeBlocks: number | null;
  countsByType: Record<string, number>;
  totalNights: number | null;
  sellableNights: number | null;
  sellablePercentage: number | null;
  needsAttention: { id: string; kind: string; name: string; reason: string }[];
  coverage:
    | null
    | {
        roomTypeId: string;
        name: string;
        rooms?: {
          id: string;
          name: string;
          days: {
            date: string;
            available: boolean | null;
            restrictionErrors: { code: string; message: string }[];
          }[];
        }[];
        days: {
          date: string;
          capacity: number;
          available: number;
          restrictionErrors: { code: string; message: string }[];
        }[];
      }[];
};
export const restrictionLabels: Record<string, string> = {
  minimum_stay: 'Minimum stay',
  maximum_stay: 'Maximum stay',
  closed_to_arrival: 'Closed to arrival',
  closed_to_departure: 'Closed to departure',
  stop_sell: 'Stop sell',
  minimum_advance: 'Minimum advance',
};
export const blockReasonLabels: Record<string, string> = {
  maintenance: 'Maintenance',
  renovation: 'Renovation',
  safety_inspection: 'Safety inspection',
  deep_cleaning: 'Deep cleaning',
  owner_use: 'Owner use',
  house_use: 'House or staff use',
  event: 'Event',
  out_of_service: 'Out of service',
  other: 'Other',
};
export const recordName = (r: InventoryRecord) => r.name ?? r.title ?? 'Manual block';
export const inventoryScope = (
  r: InventoryRecord,
  catalog: CatalogItem[],
  categories: CatalogItem[],
  rooms: CatalogItem[],
) =>
  r.scope === 'property' || r.all
    ? 'Entire property'
    : r.scope === 'category'
      ? (r.targetIds ?? [])
          .map((id) => categories.find((c) => c.id === id)?.name ?? 'Missing category')
          .join(', ')
      : [
          ...(r.targetIds ?? r.roomTypeIds ?? []).map(
            (id) => catalog.find((c) => c.id === id)?.name ?? 'Missing room type',
          ),
          ...(r.roomIds ?? []).map((id) => rooms.find((c) => c.id === id)?.name ?? 'Missing room'),
        ].join(', ');
