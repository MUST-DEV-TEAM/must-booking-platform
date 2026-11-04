import { venueBase, venueCall } from './venue-api';

export type ReservationStatus =
  'pending_payment' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';

/** How a booking reached the restaurant when staff typed it in. */
export type StaffSource =
  | 'phone'
  | 'walk_in'
  | 'whatsapp'
  | 'instagram'
  | 'facebook'
  | 'viber'
  | 'messenger'
  | 'email'
  | 'hotel_reception'
  | 'google'
  | 'tripadvisor'
  | 'other';

export type Reservation = {
  depositTerms?: DepositQuote | null;
  paymentHoldExpiresAt?: string | null;
  paidDeposit?: string;
  requiresRefundReview?: boolean;
  refundState?: string | null;
  checkout?: { state: string; url: string | null } | null;
  id: string;
  reference: string;
  status: ReservationStatus;
  /** ISO instants; show them in the restaurant's time zone. */
  startsAt: string;
  endsAt: string;
  partySize: number;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  guestId: string | null;
  notes: string | null;
  source: string;
  seatedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  tables: Array<{ id: string; label: string; areaId: string; areaName: string }>;
  /** The guest's hotel stay around the booking date, when they have one. */
  stay: { bookingId: string; startsOn: string; endsOn: string; room: string | null } | null;
};

export type ReservationList = { total?: number; timezone: string; reservations: Reservation[] };

export type AvailabilitySlot = {
  time: string;
  startsAt: string;
  bookable: boolean;
  past: boolean;
  freeTables: Array<{
    id: string;
    label: string;
    areaId: string;
    minSeats: number;
    maxSeats: number;
    areaName?: string;
    priority?: number;
  }>;
  bestTableId: string | null;
  freeAreas?: Array<{ id: string; name: string; tables: AvailabilitySlot['freeTables'] }>;
};

export type Availability = {
  date: string;
  partySize: number;
  diningMinutes: number;
  /** Why nothing is offered: the restaurant is closed that day, or an online rule applies. */
  reason: 'CLOSED' | 'PARTY_TOO_LARGE' | 'TOO_FAR_AHEAD' | null;
  services: Array<{ name: string; opensAt: string; closesAt: string; slots: AvailabilitySlot[] }>;
};

export type TableState = 'free' | 'reserved' | 'seated' | 'finishing' | 'overrun' | 'blocked';

export type FloorBookingSummary = {
  id: string;
  reference: string;
  status: ReservationStatus;
  guestName: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
};

export type FloorTable = {
  id: string;
  areaId: string;
  label: string;
  minSeats: number;
  maxSeats: number;
  mapX: number;
  mapY: number;
  mapWidth: number;
  mapHeight: number;
  shape: 'square' | 'round' | 'rect';
  active: boolean;
  status: TableState;
  bookings?: FloorBookingSummary[];
  current: FloorBookingSummary | null;
  next: FloorBookingSummary | null;
};

export type Floor = {
  from?: string;
  to?: string;
  at: string;
  timezone: string;
  areas: Array<{
    id: string;
    name: string;
    mapWidth: number;
    mapHeight: number;
    tables: FloorTable[];
  }>;
};

export type ReservationInput = {
  requestKey?: string;
  depositQuoteHash?: string;
  depositAmount?: string;
  depositOverrideReason?: string;
  durationMinutes?: number;
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  notes?: string;
  source?: StaffSource;
  tableId?: string;
};

export type DepositQuote = {
  amount: string;
  suggestedAmount: string;
  currency: string;
  freeCancelHours: number;
  quoteHash: string;
  canOverride: boolean;
  serviceName: string;
  areaName: string;
};

export type ReservationListQuery = {
  from: string;
  to?: string;
  status?: ReservationStatus[];
  q?: string;
  limit?: number;
  offset?: number;
  sort?: 'startsAt' | 'guestName' | 'partySize' | 'status' | 'table';
  order?: 'asc' | 'desc';
};

export type SettableStatus = 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
};

export const reservationApi = {
  quote: (tenantId: string, venueId: string, input: Partial<ReservationInput>) =>
    venueCall<DepositQuote>('POST', `${venueBase(tenantId, venueId)}/deposit-rules/quote`, input),
  sendPaymentLink: (tenantId: string, venueId: string, id: string) =>
    venueCall<{ queued: boolean }>(
      'POST',
      `${venueBase(tenantId, venueId)}/reservations/${id}/send-payment-link`,
    ),
  refund: (tenantId: string, venueId: string, id: string) =>
    venueCall<{ state: string }>(
      'POST',
      `${venueBase(tenantId, venueId)}/reservations/${id}/refund-deposit`,
    ),
  availability: (
    tenantId: string,
    venueId: string,
    params: {
      date: string;
      partySize: number;
      areaId?: string;
      durationMinutes?: number;
      time?: string;
    },
  ) =>
    venueCall<Availability>(
      'GET',
      `${venueBase(tenantId, venueId)}/availability?${query({
        date: params.date,
        partySize: String(params.partySize),
        areaId: params.areaId,
        durationMinutes:
          params.durationMinutes === undefined ? undefined : String(params.durationMinutes),
        time: params.time,
      })}`,
    ),
  list: (tenantId: string, venueId: string, params: ReservationListQuery) =>
    venueCall<ReservationList>(
      'GET',
      `${venueBase(tenantId, venueId)}/reservations?${query({
        from: params.from,
        to: params.to,
        status: params.status?.join(','),
        q: params.q,
        limit: params.limit === undefined ? undefined : String(params.limit),
        offset: params.offset === undefined ? undefined : String(params.offset),
        sort: params.sort,
        order: params.order,
      })}`,
    ),
  create: (tenantId: string, venueId: string, input: ReservationInput) =>
    venueCall<Reservation>('POST', `${venueBase(tenantId, venueId)}/reservations`, input),
  get: (tenantId: string, venueId: string, id: string) =>
    venueCall<Reservation>('GET', `${venueBase(tenantId, venueId)}/reservations/${id}`),
  setStatus: (
    tenantId: string,
    venueId: string,
    reservationId: string,
    status: SettableStatus,
    note?: string,
  ) =>
    venueCall<Reservation>(
      'POST',
      `${venueBase(tenantId, venueId)}/reservations/${reservationId}/status`,
      { status, ...(note ? { note } : {}) },
    ),
  floor: (tenantId: string, venueId: string, atOrPeriod?: string | { from: string; to: string }) =>
    venueCall<Floor>(
      'GET',
      `${venueBase(tenantId, venueId)}/floor?${query(typeof atOrPeriod === 'string' ? { at: atOrPeriod } : (atOrPeriod ?? {}))}`,
    ),
};
