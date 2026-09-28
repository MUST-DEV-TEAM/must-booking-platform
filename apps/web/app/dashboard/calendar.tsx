'use client';

import { Card, Heading, Stack, StatePanel, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Fragment, type CSSProperties, type FormEvent, useMemo, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { toast } from 'sonner';

import { fetchPropertyBookings, type Reservation } from './reservations';
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
// A single grid row: one physical room when the property tracks individual
// rooms (INDIVIDUAL_ROOM_ONLY/MIXED), or one room type when it doesn't
// (ROOM_TYPE_ONLY has no rooms to show a row for) — same tape-chart layout
// either way, just a different unit of "what's the row."
export type CalendarRow = {
  id: string;
  label: string;
  // A room row has exactly 1 unit (itself); a room-type row has as many
  // units as that type has rooms/inventory. Needed so a fully-available
  // single room reads as "available", not "limited" (1 out of 1, not 1
  // out of many).
  totalUnits: number;
  // date (YYYY-MM-DD) -> remaining units for that night.
  availableByDate: Record<string, number>;
};

type CalendarData = {
  roomTypes: RoomType[];
  rooms: Room[];
  availability: CalendarAvailability[];
  rows: CalendarRow[];
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
  initialRows,
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
  // Grid rows for the initial render. Only needed when initialRooms is
  // non-empty — initialRooms alone (id/name only) can't build per-room
  // month availability without a fetch, so without this the room-level
  // grid always does one real fetch before it can render.
  initialRows?: CalendarRow[];
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
  // Rooms drive the main grid's rows for everyone with calendar.view, not
  // just staff who can also manage blocks — that's a separate permission
  // checked further down for the Block availability section itself.
  const includeRooms = canTargetRooms;
  const availabilityQueryKey = [
    'dashboard',
    'calendar-availability',
    tenantId,
    propertyId,
    month,
    includeRooms,
  ] as const;
  // initialRooms (when provided) only carries id/name, not per-room month
  // availability, so building rows needs either initialRows explicitly, or
  // no rooms at all (ROOM_TYPE_ONLY, where rows come from room-type counts).
  const hasInitialCalendarData =
    initialRoomTypes &&
    initialAvailability &&
    initialMonth === month &&
    (!includeRooms || initialRows !== undefined || (initialRooms?.length ?? 0) === 0);
  const initialCalendarData = hasInitialCalendarData
    ? {
        roomTypes: initialRoomTypes,
        rooms: initialRooms ?? [],
        availability: initialAvailability,
        rows: initialRows ?? initialRoomTypes.map((roomType) => {
          const forType = initialAvailability.filter((item) => item.roomTypeId === roomType.id);
          return {
            id: roomType.id,
            label: roomType.name,
            totalUnits: forType.reduce((max, item) => Math.max(max, item.availableUnits), 0),
            availableByDate: Object.fromEntries(
              forType.map((item) => [item.startsOn, item.availableUnits]),
            ),
          };
        }),
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
  const monthDays = useMemo(() => days.filter((day): day is string => day !== null), [days]);
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

  if (
    availabilityQuery.isPending ||
    bookingsQuery.isPending ||
    (canManageAvailability && blocksQuery.isPending)
  )
    return (
      <StatePanel
        body={null}
        icon={<Loader2 aria-hidden="true" />}
        title="Loading calendar…"
        variant="loading"
      />
    );
  const error =
    availabilityQuery.error ??
    bookingsQuery.error ??
    (canManageAvailability ? blocksQuery.error : null);
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
          <Text tone="secondary">
            {includeRooms
              ? 'Nightly availability by room.'
              : 'Nightly availability by room type.'}
          </Text>
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
        <div className={styles.tapeChartScroll}>
          <div
            className={styles.tapeChart}
            style={{ '--must-tape-chart-days': monthDays.length } as CSSPropertiesWithVars}
          >
            <div className={styles.tapeChartCorner} />
            {monthDays.map((day) => (
              <button
                key={day}
                type="button"
                className={styles.tapeChartDayHeader}
                aria-label={`Open ${day}`}
                onClick={() => setSelectedDay(day)}
              >
                <span className={styles.tapeChartWeekday}>{formatWeekdayShort(day)}</span>
                <span className={styles.tapeChartDayNumber}>{Number(day.slice(-2))}</span>
              </button>
            ))}
            {calendarData.rows.map((row) => (
              <Fragment key={row.id}>
                <div className={styles.tapeChartRowLabel}>{row.label}</div>
                {monthDays.map((day) => {
                  const remaining = row.availableByDate[day] ?? 0;
                  return (
                    <button
                      key={`${row.id}-${day}`}
                      type="button"
                      className={`${styles.tapeChartCell} ${availabilityClass(remaining, row.totalUnits)}`}
                      aria-label={`${row.label}, ${formatDay(day)}: ${remaining > 0 ? `${remaining} available` : 'sold out'}`}
                      title={`${row.label}: ${remaining > 0 ? `${remaining} available` : 'Sold out'}`}
                      onClick={() => setSelectedDay(day)}
                    >
                      {remaining > 1 ? remaining : ''}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
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

              <fieldset className={styles.chipField}>
                <legend>Room types to block</legend>
                <div className={styles.chipGroup} role="group" aria-label="Room types to block">
                  {calendarData.roomTypes.map((roomType) => (
                    <label key={roomType.id} className={styles.chip}>
                      <input
                        type="checkbox"
                        checked={blockRoomTypeIds.includes(roomType.id)}
                        onChange={(event) =>
                          setBlockRoomTypeIds((current) =>
                            event.target.checked
                              ? [...current, roomType.id]
                              : current.filter((id) => id !== roomType.id),
                          )
                        }
                      />
                      {roomType.name}
                    </label>
                  ))}
                </div>
              </fieldset>

              {canTargetRooms ? (
                <fieldset className={styles.chipField}>
                  <legend>Specific rooms to block</legend>
                  <div className={styles.chipGroup} role="group" aria-label="Specific rooms to block">
                    {calendarData.rooms.map((room) => {
                      const roomTypeName =
                        calendarData.roomTypes.find((roomType) => roomType.id === room.roomTypeId)
                          ?.name ?? 'Room type';
                      return (
                        <label key={room.id} className={styles.chip}>
                          <input
                            type="checkbox"
                            checked={blockRoomIds.includes(room.id)}
                            onChange={(event) =>
                              setBlockRoomIds((current) =>
                                event.target.checked
                                  ? [...current, room.id]
                                  : current.filter((id) => id !== room.id),
                              )
                            }
                          />
                          {roomTypeName} — {room.name}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
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
  if (!response.ok)
    throw new Error(await errorMessage(response, 'Unable to load availability blocks.'));
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

  const rows = rooms.length
    ? await Promise.all(
        rooms.map(async (room): Promise<CalendarRow> => {
          const response = await fetch(
            `/api/tenants/${tenantId}/properties/${propertyId}/availability-calendar?${new URLSearchParams(
              { roomTypeId: room.roomTypeId, roomId: room.id, month },
            )}`,
            { credentials: 'include' },
          );
          if (!response.ok) throw new Error('Unable to load room calendar.');
          const { days: monthDays } = (await response.json()) as {
            days: Array<{ date: string; isAvailable: boolean }>;
          };
          return {
            id: room.id,
            label: room.name,
            totalUnits: 1,
            availableByDate: Object.fromEntries(
              monthDays.map(({ date, isAvailable }) => [date, isAvailable ? 1 : 0]),
            ),
          };
        }),
      )
    : roomTypes.map((roomType): CalendarRow => {
        const forType = availability.filter((item) => item.roomTypeId === roomType.id);
        return {
          id: roomType.id,
          label: roomType.name,
          // No room-level data exists for ROOM_TYPE_ONLY properties, so the
          // best available proxy for total capacity is the most units ever
          // seen free in the month — availableUnits can't exceed it.
          totalUnits: forType.reduce((max, item) => Math.max(max, item.availableUnits), 0),
          availableByDate: Object.fromEntries(
            forType.map((item) => [item.startsOn, item.availableUnits]),
          ),
        };
      });

  return { roomTypes, rooms, availability, rows };
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
function formatWeekdayShort(day: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}
type CSSPropertiesWithVars = CSSProperties & { '--must-tape-chart-days'?: number };
function availabilityClass(remainingUnits: number, totalUnits: number) {
  if (remainingUnits <= 0) return styles.unavailable;
  // "Limited" means down to the last unit or two of a multi-unit row (a
  // room-type row with several rooms left). A single-unit room row is
  // either fully available (1 of 1) or sold out (0 of 1) — never limited.
  if (totalUnits > 1 && remainingUnits <= Math.min(2, totalUnits - 1)) return styles.limited;
  return styles.available;
}

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}
