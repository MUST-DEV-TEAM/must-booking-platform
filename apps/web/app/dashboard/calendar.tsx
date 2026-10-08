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
  // Nights with rooms still free that were switched off for sale in the PMS
  // (stop-sale, e.g. a staff vacation block) - not the same thing as sold out.
  closedByDate?: Record<string, boolean>;
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
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockStep, setBlockStep] = useState<'room-type' | 'room' | 'dates'>('room-type');
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
        rows:
          initialRows ??
          initialRoomTypes.map((roomType): CalendarRow => {
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
    initialData: initialBlocks,
    staleTime: initialBlocks ? Infinity : 0,
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
      closeBlockDialog();
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
      // roomTypeIds picked in step 1 is only ever used to narrow which rooms
      // show up in step 2 — a room-type block independently blocks every
      // room of that type (availability_block_room_types), so sending it
      // alongside specific roomIds would block the whole type, not just the
      // chosen rooms. Only send it when no specific room was chosen.
      roomTypeIds: blockRoomIds.length > 0 ? [] : blockRoomTypeIds,
      roomIds: blockRoomIds,
    });
  }

  function openBlockDialog() {
    setBlockStep('room-type');
    setBlockRange(undefined);
    setBlockAll(false);
    setBlockRoomTypeIds([]);
    setBlockRoomIds([]);
    setBlockDialogOpen(true);
  }

  function closeBlockDialog() {
    setBlockDialogOpen(false);
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
            {includeRooms ? 'Nightly availability by room.' : 'Nightly availability by room type.'}
          </Text>
        </div>
        <div className={styles.headingActions}>
          {canManageAvailability ? (
            <button
              className="must-button must-button--secondary"
              onClick={openBlockDialog}
              type="button"
            >
              Block availability
            </button>
          ) : null}
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
          <span>
            <i className={styles.closed} /> Closed
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
                  const isClosed = row.closedByDate?.[day] === true;
                  // A closed night reads as closed even if the day-level count still shows free rooms.
                  const remaining = isClosed ? 0 : (row.availableByDate[day] ?? 0);
                  const stateLabel = isClosed
                    ? 'Closed'
                    : remaining > 0
                      ? `${remaining} available`
                      : 'Sold out';
                  return (
                    <button
                      key={`${row.id}-${day}`}
                      type="button"
                      className={`${styles.tapeChartCell} ${isClosed ? styles.closed : availabilityClass(remaining, row.totalUnits)}`}
                      aria-label={`${row.label}, ${formatDay(day)}: ${stateLabel.toLowerCase()}`}
                      title={`${row.label}: ${stateLabel}`}
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

      {selectedDay && selectedBookings ? (
        <DayBookings day={selectedDay} bookings={selectedBookings} />
      ) : null}

      {blockDialogOpen ? (
        <BlockAvailabilityDialog
          blockAll={blockAll}
          blockRange={blockRange}
          blockRoomIds={blockRoomIds}
          blockRoomTypeIds={blockRoomTypeIds}
          blockStep={blockStep}
          calendarData={calendarData}
          canTargetRooms={canTargetRooms}
          existingBlocks={blocksQuery.data ?? []}
          month={month}
          onClose={closeBlockDialog}
          onRemoveBlock={(blockId) => removeBlockMutation.mutate(blockId)}
          onSubmit={createAvailabilityBlock}
          removingBlockId={removeBlockMutation.isPending ? removeBlockMutation.variables : null}
          savingBlock={savingBlock}
          setBlockAll={setBlockAll}
          setBlockRange={setBlockRange}
          setBlockRoomIds={setBlockRoomIds}
          setBlockRoomTypeIds={setBlockRoomTypeIds}
          setBlockStep={setBlockStep}
        />
      ) : null}
    </Stack>
  );
}

type BlockStep = 'room-type' | 'room' | 'dates';
// Synthetic option value for the room-types <select multiple> — selecting
// it is equivalent to the old "Block all room types" checkbox, but lives
// as a normal option instead of a separate control.
const ALL_ROOM_TYPES_VALUE = '__all_room_types__';

/**
 * Step-by-step popup for creating an availability block: room type(s) first,
 * then specific rooms of those types (skipped for ROOM_TYPE_ONLY properties
 * or when "all room types" is chosen), then the date range. Replaces the
 * old single long form — same underlying state/submit as before, just
 * walked through one decision at a time instead of all at once.
 */
function BlockAvailabilityDialog({
  blockAll,
  blockRange,
  blockRoomIds,
  blockRoomTypeIds,
  blockStep,
  calendarData,
  canTargetRooms,
  existingBlocks,
  month,
  onClose,
  onRemoveBlock,
  onSubmit,
  removingBlockId,
  savingBlock,
  setBlockAll,
  setBlockRange,
  setBlockRoomIds,
  setBlockRoomTypeIds,
  setBlockStep,
}: {
  blockAll: boolean;
  blockRange: DateRange | undefined;
  blockRoomIds: string[];
  blockRoomTypeIds: string[];
  blockStep: BlockStep;
  calendarData: CalendarData;
  canTargetRooms: boolean;
  existingBlocks: AvailabilityBlock[];
  month: string;
  onClose: () => void;
  onRemoveBlock: (blockId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  removingBlockId: string | null | undefined;
  savingBlock: boolean;
  setBlockAll: (value: boolean) => void;
  setBlockRange: (value: DateRange | undefined) => void;
  setBlockRoomIds: (updater: (current: string[]) => string[]) => void;
  setBlockRoomTypeIds: (updater: (current: string[]) => string[]) => void;
  setBlockStep: (step: BlockStep) => void;
}) {
  const roomsForSelectedTypes = calendarData.rooms.filter((room) =>
    blockRoomTypeIds.includes(room.roomTypeId),
  );
  const showRoomStep = canTargetRooms && !blockAll && roomsForSelectedTypes.length > 0;

  // Blocks that already cover any room/room-type this dialog is about to
  // target, so staff can see an overlap before creating a duplicate block
  // rather than only finding out from the grid afterward.
  const targetRoomTypeIds = blockRoomIds.length
    ? new Set(
        blockRoomIds
          .map((roomId) => calendarData.rooms.find((room) => room.id === roomId)?.roomTypeId)
          .filter((id): id is string => !!id),
      )
    : new Set(blockRoomTypeIds);
  const relevantExistingBlocks = blockAll
    ? existingBlocks
    : existingBlocks.filter(
        (block) =>
          block.all ||
          block.roomTypeIds.some((id) => targetRoomTypeIds.has(id)) ||
          block.roomIds.some((id) => blockRoomIds.includes(id)),
      );
  // Nights already covered by a relevant block can't be picked as the start
  // or end of a new one — endsOn is exclusive, matching how blocks are
  // stored/applied everywhere else in this file.
  const disabledNights = relevantExistingBlocks.map((block) => ({
    from: new Date(`${block.startsOn}T00:00:00`),
    to: new Date(`${addDays(block.endsOn, -1)}T00:00:00`),
  }));

  function goToRoomOrDatesStep() {
    if (!blockAll && blockRoomTypeIds.length === 0) {
      toast.error('Choose at least one room type, or block all room types.');
      return;
    }
    setBlockStep(showRoomStep ? 'room' : 'dates');
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <section
        aria-labelledby="availability-block-dialog-title"
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        role="dialog"
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <Heading id="availability-block-dialog-title">Block availability</Heading>
          <Text tone="secondary">
            {blockStep === 'room-type'
              ? 'Step 1 of 3 — which room types?'
              : blockStep === 'room'
                ? 'Step 2 of 3 — which rooms?'
                : `Step ${showRoomStep ? 3 : 2} of ${showRoomStep ? 3 : 2} — which nights?`}
          </Text>
        </header>

        {blockStep === 'room-type' ? (
          <div className={styles.dialogFields}>
            <label htmlFor="block-room-types">
              Room types to block
              <select
                id="block-room-types"
                multiple
                size={Math.min(6, calendarData.roomTypes.length + 1)}
                value={blockAll ? [ALL_ROOM_TYPES_VALUE] : blockRoomTypeIds}
                onChange={(event) => {
                  const values = Array.from(event.target.selectedOptions, (option) => option.value);
                  if (values.includes(ALL_ROOM_TYPES_VALUE)) {
                    setBlockAll(true);
                    setBlockRoomTypeIds(() => []);
                  } else {
                    setBlockAll(false);
                    setBlockRoomTypeIds(() => values);
                  }
                }}
              >
                <option value={ALL_ROOM_TYPES_VALUE}>All room types</option>
                {calendarData.roomTypes.map((roomType) => (
                  <option key={roomType.id} value={roomType.id}>
                    {roomType.name}
                  </option>
                ))}
              </select>
            </label>
            <Text tone="secondary">Hold Ctrl (Cmd on Mac) to select more than one.</Text>
          </div>
        ) : null}

        {blockStep === 'room' ? (
          <div className={styles.dialogFields}>
            <label htmlFor="block-rooms">
              Specific rooms to block
              <select
                id="block-rooms"
                multiple
                size={Math.min(8, roomsForSelectedTypes.length + 1)}
                value={blockRoomIds}
                onChange={(event) =>
                  setBlockRoomIds(() =>
                    Array.from(event.target.selectedOptions, (option) => option.value),
                  )
                }
              >
                {roomsForSelectedTypes.map((room) => {
                  const roomTypeName =
                    calendarData.roomTypes.find((roomType) => roomType.id === room.roomTypeId)
                      ?.name ?? 'Room type';
                  return (
                    <option key={room.id} value={room.id}>
                      {roomTypeName} — {room.name}
                    </option>
                  );
                })}
              </select>
            </label>
            <Text tone="secondary">
              Leave every room unselected to block all rooms of the selected type(s). Hold Ctrl (Cmd
              on Mac) to select more than one.
            </Text>
          </div>
        ) : null}

        {blockStep === 'dates' ? (
          <form className={styles.dialogFields} onSubmit={onSubmit}>
            {relevantExistingBlocks.length > 0 ? (
              <div className={styles.existingBlocksNotice} role="note">
                <Text>
                  <strong>Already blocked</strong>
                </Text>
                <ul>
                  {relevantExistingBlocks.map((block) => (
                    <li key={block.id}>
                      <Text tone="secondary">
                        {availabilityBlockDescription(block, calendarData)}
                      </Text>
                      <button
                        className={`must-button must-button--secondary ${styles.smallButton}`}
                        disabled={removingBlockId === block.id}
                        onClick={() => onRemoveBlock(block.id)}
                        type="button"
                      >
                        {removingBlockId === block.id ? 'Removing…' : 'Remove'}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <fieldset>
              <legend>Unavailable nights</legend>
              <DayPicker
                mode="range"
                min={1}
                selected={blockRange}
                onSelect={setBlockRange}
                defaultMonth={new Date(`${month}-01T00:00:00`)}
                disabled={disabledNights}
              />
              <Text aria-live="polite" tone="secondary">
                {blockRange?.from && blockRange.to
                  ? `${formatDay(dateToIsoDay(blockRange.from))} through ${formatDay(dateToIsoDay(blockRange.to))}`
                  : 'Choose the first and last unavailable night.'}
              </Text>
            </fieldset>
            <footer className={styles.dialogActions}>
              <button
                className="must-button must-button--secondary"
                disabled={savingBlock}
                onClick={() => setBlockStep(showRoomStep ? 'room' : 'room-type')}
                type="button"
              >
                Back
              </button>
              <button
                className="must-button must-button--primary"
                disabled={savingBlock}
                type="submit"
              >
                {savingBlock ? (
                  <>
                    <Loader2 aria-hidden="true" size={16} /> Creating…
                  </>
                ) : (
                  'Create availability block'
                )}
              </button>
            </footer>
          </form>
        ) : (
          <footer className={styles.dialogActions}>
            <button className="must-button must-button--secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="must-button must-button--primary"
              onClick={
                blockStep === 'room-type' ? goToRoomOrDatesStep : () => setBlockStep('dates')
              }
              type="button"
            >
              Next
            </button>
          </footer>
        )}
      </section>
    </div>
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

  // One month-wide request per room type tells "closed" (stop-sale) apart from
  // "sold out". It only adds detail, so a failed request leaves the grid as before.
  const closedByType: Record<string, Record<string, boolean>> = rooms.length
    ? {}
    : Object.fromEntries(
        await Promise.all(
          roomTypes.map(async (roomType) => {
            try {
              const response = await fetch(
                `/api/tenants/${tenantId}/properties/${propertyId}/availability-calendar?${new URLSearchParams({ roomTypeId: roomType.id, month })}`,
                { credentials: 'include' },
              );
              if (!response.ok) return [roomType.id, {}] as const;
              const body = (await response.json()) as {
                days?: Array<{ date: string; status?: string }>;
              };
              return [
                roomType.id,
                Object.fromEntries(
                  (body.days ?? [])
                    .filter((entry) => entry.status === 'closed')
                    .map((entry) => [entry.date, true]),
                ),
              ] as const;
            } catch {
              return [roomType.id, {}] as const;
            }
          }),
        ),
      );

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
          closedByDate: closedByType[roomType.id],
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
