import type { PriceBreakdownData } from '../../components/ui/price-breakdown';
export type PricingKind = 'plans' | 'rules' | 'charges';
export type PricingRecord = {
  id: string;
  name: string;
  lifecycle: string;
  version: number;
  code?: string;
  currency?: string | null;
  description?: string;
  pricingBasis?: string;
  basePlanId?: string | null;
  adjustmentKind?: string;
  adjustmentValue?: string;
  roomTypeIds: string[];
  ratePlanIds?: string[];
  channels?: string[];
  mealPlan?: string;
  isFallback?: boolean;
  minStay?: number | null;
  maxStay?: number | null;
  minAdvance?: number | null;
  maxAdvance?: number | null;
  publicationStartsOn?: string | null;
  publicationEndsOn?: string | null;
  mode?: string;
  value?: string;
  priority?: number;
  startsOn?: string;
  endsOn?: string | null;
  weekdays?: number[];
  basis?: string;
  display?: string;
  category?: string | null;
  confirmed?: boolean;
  note?: string;
};
export type PricingIssue = {
  id: string;
  code: string;
  severity: string;
  name: string;
  scope: string;
  message: string;
  kind?: PricingKind;
  recordId?: string;
};
export type PricingWorkspace = {
  source: 'LOCAL' | 'CLOCK_PMS';
  readOnly: boolean;
  today: string;
  timezone: string;
  bookingMode: string;
  pricingVersion: number;
  roomTypes: { id: string; name: string; status: string }[];
  rooms: { id: string; name: string; roomTypeId: string }[];
  plans: PricingRecord[];
  rules: PricingRecord[];
  charges: PricingRecord[];
  base: {
    id: string;
    ratePlanId: string;
    roomTypeId: string;
    startsOn: string | null;
    endsOn: string | null;
    weekdays: number[];
    amount: string;
    version: number;
  }[];
  roomOverrides: { ratePlanId: string; roomId: string; amount: string; version: number }[];
  issues: PricingIssue[];
  coverage: {
    startsOn: string;
    endsOn: string;
    horizonComplete: boolean;
    pricedCells: number;
    totalCells: number;
    percentage: number | null;
    example: string;
  } | null;
};
export type PricingPreview = PriceBreakdownData & {
  source: 'LOCAL' | 'CLOCK_PMS';
  valid: boolean;
  errors: { code: string; message: string; date?: string }[];
};
export const priceDay = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
export const weekdayOptions = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
].map((label, i) => ({ label, value: String(i + 1) }));
export const mealOptions = [
  { value: 'room_only', label: 'Room only' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'half_board', label: 'Half board' },
  { value: 'full_board', label: 'Full board' },
];
export const chargeBases = [
  { value: 'percentage_accommodation', label: 'Percentage of accommodation' },
  {
    value: 'percentage_subtotal',
    label: 'Percentage of booking subtotal before percentage charges',
  },
  { value: 'per_adult_night', label: 'Per adult per night' },
  { value: 'per_person_night', label: 'Per person per night' },
  { value: 'per_stay', label: 'Once per room reservation' },
];
