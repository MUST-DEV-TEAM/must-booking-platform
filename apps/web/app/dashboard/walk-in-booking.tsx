'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DayPicker, type DateRange } from 'react-day-picker';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import styles from './walk-in-booking.module.css';

type RoomType = { id: string; name: string; roomCount: number };
type Room = { id: string; name: string; roomTypeId: string; roomTypeName: string };
type RatePlan = { id: string; name: string; currency: string };
type Quote = { total: { amount: string; currency: string } };
type StayInput = {
  roomTypeId: string;
  roomId?: string;
  ratePlanId?: string;
  startsOn: string;
  endsOn: string;
};
type Guest = { firstName: string; lastName: string; email: string; phone: string };
type PaymentMethod = 'cash' | 'card_in_person' | 'bank_transfer' | '';
type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
const key = () => crypto.randomUUID();
// Sentinel for "browse every room regardless of type" — never sent to the
// API, always resolved down to a real roomTypeId before any request.
const ALL_ROOM_TYPES = '__ALL__';

export function WalkInBooking({
  tenantId,
  propertyId,
  bookingMode,
}: {
  tenantId: string;
  propertyId: string;
  bookingMode?: BookingMode;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [roomTypeSelection, setRoomTypeSelection] = useState('');
  const [roomId, setRoomId] = useState('');
  const [ratePlanId, setRatePlanId] = useState('');
  const [range, setRange] = useState<DateRange | undefined>();
  const [month, setMonth] = useState(() => new Date());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [guest, setGuest] = useState<Guest>({ firstName: '', lastName: '', email: '', phone: '' });
  const [method, setMethod] = useState<PaymentMethod>('');

  // A Clock-connected property is always priced live from Clock (no local
  // rate plan picker); a local property still needs one picked explicitly.
  const statusQuery = useQuery({
    queryKey: ['dashboard', 'walk-in-booking-pms-status', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}/pms-connection-status`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to determine the PMS connection.');
      return (await response.json()) as { provider: 'CLOCK_PMS' | 'LOCAL' };
    },
  });
  const isClockConnected = statusQuery.data?.provider === 'CLOCK_PMS';

  const catalogQuery = useQuery({
    queryKey: ['dashboard', 'walk-in-booking-catalog', tenantId, propertyId],
    queryFn: async () => {
      const [roomTypesResponse, roomsResponse, ratesResponse] = await Promise.all([
        fetch(`${base}/room-types`, { credentials: 'include' }),
        fetch(`${base}/rooms`, { credentials: 'include' }),
        fetch(`${base}/rate-plans`, { credentials: 'include' }),
      ]);
      if (!roomTypesResponse.ok || !roomsResponse.ok || !ratesResponse.ok)
        throw new Error('Unable to load rooms and rates.');
      const [roomTypes, rooms, rates] = (await Promise.all([
        roomTypesResponse.json(),
        roomsResponse.json(),
        ratesResponse.json(),
      ])) as [RoomType[], Room[], RatePlan[]];
      // Room types with zero actual rooms (legacy/demo entries that still
      // have real booking history and can't just be deleted) aren't
      // bookable — exclude them from the picker.
      return { roomTypes: roomTypes.filter((rt) => rt.roomCount > 0), rooms, rates };
    },
  });
  const roomTypes = catalogQuery.data?.roomTypes ?? [];
  const rooms = catalogQuery.data?.rooms ?? [];
  const rates = catalogQuery.data?.rates ?? [];

  const showIndividualRoom = bookingMode === 'INDIVIDUAL_ROOM_ONLY' || bookingMode === 'MIXED';
  const roomOptions =
    roomTypeSelection === ALL_ROOM_TYPES
      ? rooms
      : rooms.filter((room) => room.roomTypeId === roomTypeSelection);
  // "All" has no room type of its own — once a specific room is picked,
  // its own type resolves the calendar/quote/booking room type.
  const effectiveRoomTypeId =
    roomTypeSelection === ALL_ROOM_TYPES
      ? (rooms.find((room) => room.id === roomId)?.roomTypeId ?? '')
      : roomTypeSelection;

  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const calendarQuery = useQuery({
    queryKey: [
      'dashboard',
      'walk-in-booking-calendar',
      tenantId,
      propertyId,
      effectiveRoomTypeId,
      showIndividualRoom ? roomId : '',
      monthKey,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ roomTypeId: effectiveRoomTypeId, month: monthKey });
      if (showIndividualRoom && roomId) params.set('roomId', roomId);
      const response = await fetch(`${base}/availability-calendar?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to load availability.');
      return (await response.json()) as { days: Array<{ date: string; isAvailable: boolean }> };
    },
    enabled: !!effectiveRoomTypeId,
  });
  const unavailableDates = useMemo(() => {
    const dates = new Set<string>();
    for (const day of calendarQuery.data?.days ?? []) if (!day.isAvailable) dates.add(day.date);
    return dates;
  }, [calendarQuery.data]);

  const availabilityMutation = useMutation({
    mutationFn: async (input: StayInput) => post(`${base}/quotes`, input) as Promise<Quote>,
    onMutate: () => setQuote(null),
    onSuccess: (nextQuote) => setQuote(nextQuote),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const bookingMutation = useMutation({
    mutationFn: async ({
      input,
      guest,
      method,
    }: {
      input: StayInput;
      guest: Guest;
      method: PaymentMethod;
    }) => {
      const result = await post(`${base}/staff-bookings`, { ...input, guest }, key());
      if (!result.ok) throw new Error(result.error?.message ?? 'Unable to create booking.');
      if (method) {
        const paid = await post(
          `${base}/bookings/${result.value.id}/manual-payment`,
          { method },
          key(),
        );
        if (!paid.ok)
          throw new Error(
            paid.error?.message ?? 'Booking created, but payment could not be recorded.',
          );
      }
      return method;
    },
    onSuccess: (paymentMethod) => {
      toast.success(
        paymentMethod
          ? 'Booking created and payment recorded.'
          : 'Booking created as pay at hotel.',
      );
      setQuote(null);
      setRange(undefined);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useEffect(() => {
    if (catalogQuery.isError) toast.error(errorMessage(catalogQuery.error));
  }, [catalogQuery.error, catalogQuery.isError]);

  const busy = availabilityMutation.isPending || bookingMutation.isPending;
  // range.to is the last occupied night (inclusive); endsOn/checkout is the
  // day after, matching this app's [startsOn, endsOn) convention everywhere
  // else (see calendar.tsx's identical addDays(dateToIsoDay(to), 1)).
  const startsOn = range?.from ? dateToIsoDay(range.from) : '';
  const endsOn = range?.to ? addDays(dateToIsoDay(range.to), 1) : '';
  const needsIndividualRoom = roomTypeSelection === ALL_ROOM_TYPES || showIndividualRoom;
  const canSearch =
    !!effectiveRoomTypeId &&
    (roomTypeSelection !== ALL_ROOM_TYPES || !!roomId) &&
    !!startsOn &&
    !!endsOn &&
    (isClockConnected || !!ratePlanId);
  const input: StayInput = {
    roomTypeId: effectiveRoomTypeId,
    roomId: showIndividualRoom && roomId ? roomId : undefined,
    ratePlanId: isClockConnected ? undefined : ratePlanId,
    startsOn,
    endsOn,
  };

  return (
    <Stack className={styles.page} gap="lg">
      <header>
        <Text tone="secondary">FRONT DESK</Text>
        <Heading>New walk-in booking</Heading>
        <Text tone="secondary">
          Search availability, confirm the stay, then optionally settle it at the desk.
        </Text>
      </header>
      <Card>
        <div className={styles.grid}>
          <label>
            Room type
            <select
              className="must-input"
              value={roomTypeSelection}
              onChange={(event) => {
                setRoomTypeSelection(event.target.value);
                setRoomId('');
                setRange(undefined);
                setQuote(null);
              }}
            >
              <option value="">Select room type</option>
              {roomTypes.map((roomType) => (
                <option key={roomType.id} value={roomType.id}>
                  {roomType.name}
                </option>
              ))}
              <option value={ALL_ROOM_TYPES}>All (choose a specific room)</option>
            </select>
          </label>
          {needsIndividualRoom && roomTypeSelection ? (
            <label>
              Individual room
              <select
                className="must-input"
                value={roomId}
                onChange={(event) => {
                  setRoomId(event.target.value);
                  setRange(undefined);
                  setQuote(null);
                }}
              >
                <option value="">
                  {roomTypeSelection === ALL_ROOM_TYPES ? 'Select a room' : 'Any room of this type'}
                </option>
                {roomOptions.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} ({room.roomTypeName})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!isClockConnected ? (
            <label>
              Rate plan
              <select
                className="must-input"
                value={ratePlanId}
                onChange={(event) => setRatePlanId(event.target.value)}
              >
                <option value="">Select rate</option>
                {rates.map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {rate.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {effectiveRoomTypeId ? (
          <fieldset className={styles.calendar}>
            <legend>Stay dates</legend>
            <DayPicker
              mode="range"
              min={1}
              selected={range}
              onSelect={(next) => {
                setRange(next);
                setQuote(null);
              }}
              month={month}
              onMonthChange={setMonth}
              disabled={[
                { before: new Date(new Date().toDateString()) },
                (date: Date) => unavailableDates.has(dateToIsoDay(date)),
              ]}
            />
            <Text aria-live="polite" tone="secondary">
              {startsOn && endsOn
                ? `${startsOn} through ${endsOn}`
                : 'Choose check-in and check-out.'}
            </Text>
          </fieldset>
        ) : null}

        <button
          type="button"
          className="must-button must-button--primary"
          disabled={busy || !canSearch}
          onClick={() => availabilityMutation.mutate(input)}
        >
          Search availability
        </button>

        {quote ? (
          <>
            <Text className={styles.total}>
              Total: {quote.total.amount} {quote.total.currency}
            </Text>
            <div className={styles.grid}>
              <label>
                First name
                <input
                  className="must-input"
                  value={guest.firstName}
                  onChange={(event) => setGuest({ ...guest, firstName: event.target.value })}
                />
              </label>
              <label>
                Last name
                <input
                  className="must-input"
                  value={guest.lastName}
                  onChange={(event) => setGuest({ ...guest, lastName: event.target.value })}
                />
              </label>
              <label>
                Email
                <input
                  className="must-input"
                  type="email"
                  value={guest.email}
                  onChange={(event) => setGuest({ ...guest, email: event.target.value })}
                />
              </label>
              <label>
                Phone
                <input
                  className="must-input"
                  value={guest.phone}
                  onChange={(event) => setGuest({ ...guest, phone: event.target.value })}
                />
              </label>
              <label>
                Settle now
                <select
                  className="must-input"
                  aria-label="Payment method"
                  value={method}
                  onChange={(event) => setMethod(event.target.value as typeof method)}
                >
                  <option value="">Pay at hotel later</option>
                  <option value="cash">Cash</option>
                  <option value="card_in_person">Card in person</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              className="must-button must-button--primary"
              disabled={busy || !guest.email}
              onClick={() => bookingMutation.mutate({ input, guest, method })}
            >
              {busy ? <Loader2 aria-hidden="true" size={16} /> : 'Create booking'}
            </button>
          </>
        ) : null}
      </Card>
    </Stack>
  );
}
async function json(response: Response) {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
async function post(url: string, body: unknown, idempotencyKey?: string) {
  return json(
    await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : 'Request failed.';
  try {
    const parsed = JSON.parse(raw) as { message?: string | string[] };
    return Array.isArray(parsed.message) ? parsed.message.join(' ') : (parsed.message ?? raw);
  } catch {
    return raw;
  }
}
function dateToIsoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(day: string, amount: number) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
