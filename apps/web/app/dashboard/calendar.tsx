'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { toast } from 'sonner';

import { fetchPropertyBookings, type Reservation } from './reservations';
import { DashboardLoadingSkeleton } from './loading-skeleton';
import styles from './calendar.module.css';

type RoomType = { id: string; name: string };
type Room = { id: string; name: string; roomTypeId: string };
type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
export type CalendarAvailability = {
  roomTypeId: string;
  startsOn: string;
  endsOn: string;
  isAvailable: boolean;
  availableUnits: number;
};
export type AvailabilityBlock = {
  id: string;
  startsOn: string;
  endsOn: string;
  all: boolean;
  roomTypeIds: string[];
  roomIds: string[];
};

type CalendarData = {
  roomTypes: RoomType[];
  rooms: Room[];
  availability: CalendarAvailability[];
};

export function DashboardCalendar({
  tenantId,
  propertyId,
  bookingMode,
  canManageAvailability = false,
  initialMonth,
  initialRoomTypes,
  initialRooms,
  initialAvailability,
  initialBookings,
  initialBlocks,
}: {
  tenantId: string;
  propertyId: string;
  bookingMode?: BookingMode;
  canManageAvailability?: boolean;
  initialMonth?: string;
  initialRoomTypes?: RoomType[];
  initialRooms?: Room[];
  initialAvailability?: CalendarAvailability[];
  initialBookings?: Reservation[];
  initialBlocks?: AvailabilityBlock[];
}) {
  const [month, setMonth] = useState(initialMonth ?? monthStart(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [blockRange, setBlockRange] = useState<DateRange | undefined>();
  const [blockAll, setBlockAll] = useState(false);
  const [blockRoomTypeIds, setBlockRoomTypeIds] = useState<string[]>([]);
  const [blockRoomIds, setBlockRoomIds] = useState<string[]>([]);
  const canTargetRooms = bookingMode === 'INDIVIDUAL_ROOM_ONLY' || bookingMode === 'MIXED';
  const includeRooms = canManageAvailability && canTargetRooms;
  const availabilityQueryKey = [
    'dashboard',
    'calendar-availability',
    tenantId,
    propertyId,
    month,
    includeRooms,
  ] as const;
  const hasInitialCalendarData =
    initialRoomTypes &&
    initialAvailability &&
    initialMonth === month &&
    (!includeRooms || initialRooms !== undefined);
  const initialCalendarData = hasInitialCalendarData
    ? {
        roomTypes: initialRoomTypes,
        rooms: initialRooms ?? [],
        availability: initialAvailability,
      }
    : undefined;
  const availabilityQuery = useQuery({
    queryKey: availabilityQueryKey,
    queryFn: () => fetchCalendarAvailability(tenantId, propertyId, month, includeRooms),
    initialData: initialCalendarData,
    staleTime: initialCalendarData ? Infinity : 0,
  });
  const bookingsQuery = useQuery({
    queryKey: ['dashboard', 'calendar-bookings', tenantId, propertyId],
    queryFn: () => fetchPropertyBookings(tenantId, propertyId),
    initialData: initialBookings,
    staleTime: initialBookings ? Infinity : 0,
  });
  const blocksQuery = useQuery({
    queryKey: ['dashboard', 'availability-blocks', tenantId, propertyId],
    queryFn: () => fetchAvailabilityBlocks(tenantId, propertyId),
    enabled: canManageAvailability,
    initialData: initialBlocks ?? [],
  });
  const queryClient = useQueryClient();
  const blockMutation = useMutation({
    mutationFn: async (body: {
      startsOn: string;
      endsOn: string;
      all: boolean;
      roomTypeIds: string[];
      roomIds: string[];
    }) => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/availability-blocks`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to create availability block.'));
    },
    onSuccess: () => {
      setBlockRange(undefined);
      setBlockAll(false);
      setBlockRoomTypeIds([]);
      setBlockRoomIds([]);
      void queryClient.invalidateQueries({ queryKey: availabilityQueryKey });
      toast.success('Availability block created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to create availability block.'),
  });
  const removeBlockMutation = useMutation({
    mutationFn: async (blockId: string) => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/availability-blocks/${blockId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to remove availability block.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: availabilityQueryKey });
      void queryClient.invalidateQueries({
        queryKey: ['dashboard', 'availability-blocks', tenantId, propertyId],
      });
      toast.success('Availability block removed.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to remove availability block.'),
  });

  const days = useMemo(() => calendarDays(month), [month]);
  const calendarData = availabilityQuery.data;
  const bookings = bookingsQuery.data;
  const savingBlock = blockMutation.isPending;
  const selectedBookings = selectedDay && bookings ? bookingsForDay(bookings, selectedDay) : null;

  function createAvailabilityBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!blockRange?.from || !blockRange.to) {
      toast.error('Select the first and last unavailable night.');
      return;
    }
    blockMutation.mutate({
      startsOn: dateToIsoDay(blockRange.from),
      endsOn: addDays(dateToIsoDay(blockRange.to), 1),
      all: blockAll,
      roomTypeIds: blockRoomTypeIds,
      roomIds: blockRoomIds,
    });
  }

  if (availabilityQuery.isPending || bookingsQuery.isPending || (canManageAvailability && blocksQuery.isPending))
    return <DashboardLoadingSkeleton label="Loading calendar…" />;
  const error =
    availabilityQuery.error ?? bookingsQuery.error ?? (canManageAvailability ? blocksQuery.error : null);
  if (error || !calendarData || !bookings)
    return <Text className={styles.error}>{error?.message}</Text>;

  return (
    <Stack className={styles.page} gap="lg">
      <header className={styles.heading}>
        <div>
          <Text className={styles.eyebrow} tone="secondary">
            PROPERTY OPERATIONS
          </Text>
          <Heading>Calendar</Heading>
          <Text tone="secondary">Nightly room-type availability from local inventory.</Text>
        </div>
        <div className={styles.monthControls} aria-label="Calendar month">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <strong>{formatMonth(month)}</strong>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </header>

      <Card>
        <div className={styles.legend} aria-label="Availability legend">
          <span>
            <i className={styles.available} /> Available
          </span>
          <span>
            <i className={styles.limited} /> Limited
          </span>
          <span>
            <i className={styles.unavailable} /> Sold out
          </span>
        </div>
        <div className={styles.grid}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <strong key={day} className={styles.weekday}>
              {day}
            </strong>
          ))}
          {days.map((day, index) =>
            day ? (
              <button
                key={day}
                type="button"
                className={styles.day}
                aria-label={`Open ${day}`}
                onClick={() => setSelectedDay(day)}
              >
                <time dateTime={day}>{Number(day.slice(-2))}</time>
                <div>
                  {calendarData.roomTypes.map((roomType) => {
                    const availability = calendarData.availability.find(
                      (item) => item.roomTypeId === roomType.id && item.startsOn === day,
                    );
                    return (
                      <span
                        key={roomType.id}
                        className={availabilityClass(availability?.availableUnits ?? 0)}
                        title={`${roomType.name}: ${availability?.availableUnits ?? 0} remaining`}
                      >
                        <b>{roomType.name}</b> {availability?.availableUnits ?? 0}
                      </span>
                    );
                  })}
                </div>
              </button>
            ) : (
              <div key={`empty-${index}`} className={styles.emptyDay} aria-hidden="true" />
            ),
          )}
        </div>
      </Card>

      {canManageAvailability ? (
        <Card>
          <section aria-labelledby="availability-block-heading" className={styles.blocking}>
            <Heading level={2} id="availability-block-heading">
              Block availability
            </Heading>
            <Text tone="secondary">
              Create a block for all rooms, selected room types, and specific rooms in one action.
              Calendar availability refreshes after saving.
            </Text>
            <form className={styles.blockingForm} onSubmit={createAvailabilityBlock}>
              <fieldset>
                <legend>Unavailable nights</legend>
                <DayPicker
                  mode="range"
                  min={1}
                  selected={blockRange}
                  onSelect={setBlockRange}
                  defaultMonth={new Date(`${month}-01T00:00:00`)}
                />
                <Text aria-live="polite" tone="secondary">
                  {blockRange?.from && blockRange.to
                    ? `${formatDay(dateToIsoDay(blockRange.from))} through ${formatDay(dateToIsoDay(blockRange.to))}`
                    : 'Choose the first and last unavailable night.'}
                </Text>
              </fieldset>

              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={blockAll}
                  onChange={(event) => setBlockAll(event.target.checked)}
                />
                Block all room types
              </label>

              <label>
                Room types to block
                <select
                  aria-label="Room types to block"
                  multiple
                  value={blockRoomTypeIds}
                  onChange={(event) =>
                    setBlockRoomTypeIds(
                      Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                    )
                  }
                >
                  {calendarData.roomTypes.map((roomType) => (
                    <option key={roomType.id} value={roomType.id}>
                      {roomType.name}
                    </option>
                  ))}
                </select>
              </label>

              {canTargetRooms ? (
                <label>
                  Specific rooms to block
                  <select
                    aria-label="Specific rooms to block"
                    multiple
                    value={blockRoomIds}
                    onChange={(event) =>
                      setBlockRoomIds(
                        Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                      )
                    }
                  >
                    {calendarData.rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {calendarData.roomTypes.find((roomType) => roomType.id === room.roomTypeId)
                          ?.name ?? 'Room type'}
                        {' — '}
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Text tone="secondary">
                  Specific-room targets are available for Individual-Room-Only and Mixed properties.
                </Text>
              )}

              <button type="submit" disabled={savingBlock}>
                {savingBlock ? (
                  <>
                    <Loader2 aria-hidden="true" size={16} /> Creating…
                  </>
                ) : (
                  'Create availability block'
                )}
              </button>
            </form>
            <div className={styles.blocks} aria-label="Existing availability blocks">
              <Heading level={3}>Existing blocks</Heading>
              {blocksQuery.data?.length ? (
                <ul>
                  {blocksQuery.data.map((block) => (
                    <li key={block.id}>
                      <Text>{availabilityBlockDescription(block, calendarData)}</Text>
                      <button
                        type="button"
                        disabled={removeBlockMutation.isPending}
                        onClick={() => removeBlockMutation.mutate(block.id)}
                      >
                        {removeBlockMutation.isPending ? 'Removing…' : 'Remove block'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text tone="secondary">No active availability blocks.</Text>
              )}
            </div>
          </section>
        </Card>
      ) : null}

      {selectedDay && selectedBookings ? (
        <DayBookings day={selectedDay} bookings={selectedBookings} />
      ) : null}
    </Stack>
  );
}

export async function fetchAvailabilityBlocks(
  tenantId: string,
  propertyId: string,
): Promise<AvailabilityBlock[]> {
  const response = await fetch(
    `/api/tenants/${tenantId}/properties/${propertyId}/availability-blocks`,
    { credentials: 'include' },
  );
  if (!response.ok) throw new Error(await errorMessage(response, 'Unable to load availability blocks.'));
  return (await response.json()) as AvailabilityBlock[];
}

export function availabilityBlockDescription(block: AvailabilityBlock, data: CalendarData): string {
  const targets = [
    ...(block.all ? ['all room types'] : []),
    ...block.roomTypeIds.map(
      (id) => data.roomTypes.find((roomType) => roomType.id === id)?.name ?? 'unknown room type',
    ),
    ...block.roomIds.map((id) => {
      const room = data.rooms.find((item) => item.id === id);
      if (!room) return 'unknown room';
      const roomType = data.roomTypes.find((item) => item.id === room.roomTypeId);
      return `${roomType?.name ?? 'Room type'} — ${room.name}`;
    }),
  ];
  return `${formatDay(block.startsOn)} through ${formatDay(addDays(block.endsOn, -1))}: ${targets.join(', ')}`;
}

export async function fetchCalendarAvailability(
  tenantId: string,
  propertyId: string,
  month: string,
  includeRooms = false,
): Promise<CalendarData> {
  const roomTypesResponse = await fetch(
    `/api/tenants/${tenantId}/properties/${propertyId}/room-types`,
    { credentials: 'include' },
  );
  if (!roomTypesResponse.ok) throw new Error('Unable to load room types.');
  const roomTypes = (await roomTypesResponse.json()) as RoomType[];
  const days = calendarDays(month).filter((day): day is string => day !== null);
  const [availability, rooms] = await Promise.all([
    Promise.all(
      roomTypes.flatMap((roomType) =>
        days.map(async (day) => {
          const nextDay = addDays(day, 1);
          const response = await fetch(
            `/api/tenants/${tenantId}/properties/${propertyId}/availability?${new URLSearchParams({ roomTypeId: roomType.id, startsOn: day, endsOn: nextDay })}`,
            { credentials: 'include' },
          );
          if (!response.ok) throw new Error('Unable to load calendar availability.');
          return (await response.json()) as CalendarAvailability;
        }),
      ),
    ),
    includeRooms
      ? Promise.all(
          roomTypes.map(async (roomType) => {
            const response = await fetch(
              `/api/tenants/${tenantId}/properties/${propertyId}/room-types/${roomType.id}/rooms`,
              { credentials: 'include' },
            );
            if (!response.ok) throw new Error('Unable to load rooms.');
            const rooms = (await response.json()) as Array<{ id: string; name: string }>;
            return rooms.map((room) => ({ ...room, roomTypeId: roomType.id }));
          }),
        ).then((groups) => groups.flat())
      : Promise.resolve([]),
  ]);
  return { roomTypes, rooms, availability };
}

export function bookingsForDay(bookings: Reservation[], day: string) {
  const active = bookings.filter((booking) => booking.status === 'CONFIRMED');
  return {
    arrivals: active.filter((booking) => booking.startsOn === day),
    departures: active.filter((booking) => booking.endsOn === day),
    inHouse: active.filter((booking) => booking.startsOn < day && booking.endsOn > day),
  };
}

function DayBookings({
  day,
  bookings,
}: {
  day: string;
  bookings: ReturnType<typeof bookingsForDay>;
}) {
  return (
    <section aria-label="Day bookings">
      <Card className={styles.drillIn}>
        <Heading level={2}>{formatDay(day)}</Heading>
        <Text tone="secondary">
          Read-only operational view. Inventory changes are not available here.
        </Text>
        <div className={styles.bookingColumns}>
          <BookingList label="Arrivals" bookings={bookings.arrivals} />
          <BookingList label="Departures" bookings={bookings.departures} />
          <BookingList label="In house" bookings={bookings.inHouse} />
        </div>
      </Card>
    </section>
  );
}

function BookingList({ label, bookings }: { label: string; bookings: Reservation[] }) {
  return (
    <section>
      <Heading level={3}>
        {label} ({bookings.length})
      </Heading>
      {bookings.length ? (
        <ul>
          {bookings.map((booking) => (
            <li key={booking.id}>
              <strong>
                {[booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' ') ||
                  booking.guestEmail}
              </strong>
              <Text tone="secondary">
                {booking.roomTypeName} · {booking.status.toLowerCase().replaceAll('_', ' ')}
              </Text>
            </li>
          ))}
        </ul>
      ) : (
        <Text tone="secondary">None</Text>
      )}
    </section>
  );
}

function calendarDays(month: string) {
  const first = new Date(`${month}T00:00:00Z`);
  const leading = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return [
    ...Array(leading).fill(null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
    ),
    ...Array((7 - ((leading + daysInMonth) % 7)) % 7).fill(null),
  ] as Array<string | null>;
}
function monthStart(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function addMonths(month: string, amount: number) {
  const value = new Date(`${month}-01T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + amount);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}
function addDays(day: string, amount: number) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function dateToIsoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function formatMonth(month: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}
function formatDay(day: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
function availabilityClass(availableUnits: number) {
  return availableUnits <= 0
    ? styles.unavailable
    : availableUnits === 1
      ? styles.limited
      : styles.available;
}

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}
