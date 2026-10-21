'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, CirclePlus, Lock, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePmsSource } from './use-pms-source';
import { createInventoryWriter } from './inventory-api';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { CalendarPicker } from '../../components/ui/calendar-picker';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DetailList } from '../../components/ui/detail-list';
import { IconButton } from '../../components/ui/icon-button';
import { Input } from '../../components/ui/input';
import { NumberStepper } from '../../components/ui/number-stepper';
import { SearchInput } from '../../components/ui/search-input';
import { SegmentedControl } from '../../components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { StatTile } from '../../components/ui/stat-tile';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import {
  addDays,
  barGeometry,
  blockGeometry,
  diffDays,
  occupiesNight,
  packLanes,
  STAY_STATE_LABELS,
  stayState,
  windowDays,
  type StayState,
} from '../../lib/calendar-board';
import { cleanDigits } from '../../lib/input-rules';
import { cn } from '../../lib/utils';
import { BLOCK_REASON_LABELS, BlockDialog, type BlockReason } from './block-dialog';
import { fetchAvailabilityBlocks, type AvailabilityBlock } from './calendar';
import { ReservationSheet, type ReservationRow } from './reservations-page';
import { useUnseenBookings } from './unseen-bookings';
import { useBookingRulesEvaluation } from './booking-rules';

type RoomType = { id: string; name: string; roomCount: number };
type Room = { id: string; name: string; roomTypeId: string; roomTypeName: string };
type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
type Preset = '7' | '14' | '30' | 'custom';

const LABEL_WIDTH = 208;
/** Narrowest a day column may get; wider windows scroll sideways instead of squeezing further. */
const MIN_DAY_WIDTH = 44;
const LANE_HEIGHT = 40;
const MAX_DAYS = 92;
const STORAGE_KEY = 'must.calendar.board';

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** How each state is drawn, in the same colours the Reservations list uses for the same meaning. */
const stateStyle: Record<StayState, string> = {
  expected: 'border-info/40 bg-info-surface text-info',
  in_house: 'border-success/40 bg-success-surface text-success',
  checked_out: 'border-border bg-muted text-muted-foreground',
  no_show: 'border-destructive bg-destructive text-white',
  awaiting_payment: 'border-warning/40 bg-warning-surface text-warning',
  needs_attention: 'border-destructive/40 bg-destructive-surface text-destructive',
  cancelled: 'border-dashed border-border bg-transparent text-muted-foreground line-through',
};
const STATES = Object.keys(stateStyle) as StayState[];

const guestOf = (row: ReservationRow) =>
  [row.guestFirstName, row.guestLastName].filter(Boolean).join(' ') || row.guestEmail || 'Guest';

function href(tenantId: string, propertyId: string, extra: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&${extra}`;
}

type Remembered = { preset: Preset; custom: string; typeFilter: string; hidden: StayState[] };

function loadRemembered(): Partial<Remembered> {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Remembered>;
  } catch {
    return {};
  }
}

/**
 * The reservations tape chart: one row per room (or one lane per room type when rooms are not
 * assigned), a column per day and a bar per stay. Changing how many days are shown changes the
 * column width, never the width of the chart. Read-only for now: click a bar to open the
 * reservation, click an empty day to start a reservation for it.
 */
export function CalendarBoard({
  tenantId,
  propertyId,
  bookingMode,
  canManageAvailability = false,
  canCreateBooking = false,
  target,
  embedded = false,
}: {
  tenantId: string;
  propertyId: string;
  bookingMode?: BookingMode;
  canManageAvailability?: boolean;
  canCreateBooking?: boolean;
  target?: { roomTypeId: string; roomId?: string };
  embedded?: boolean;
}) {
  const source = usePmsSource(tenantId, propertyId);
  const stockKnown = source.data === 'LOCAL';
  const capacityLabel = source.data === 'CLOCK_PMS' ? 'Unknown - managed in Clock' : 'Unknown';
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [start, setStart] = useState(() => addDays(todayIso(), -1));
  const [preset, setPreset] = useState<Preset>('14');
  const [custom, setCustom] = useState('10');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [hidden, setHidden] = useState<StayState[]>(['cancelled']);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [selected, setSelected] = useState<ReservationRow | null>(null);
  // An empty day the person clicked: nothing happens until they choose to add a reservation.
  const [cell, setCell] = useState<{
    key: string;
    day: string;
    room?: Room;
    roomTypeId: string;
    nights: number;
  } | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [openBlock, setOpenBlock] = useState<AvailabilityBlock | null>(null);
  const blockWriter = useRef(createInventoryWriter());
  const unseen = useUnseenBookings(tenantId, propertyId);
  const queryClient = useQueryClient();

  // Remember how this person likes the calendar set up.
  useEffect(() => {
    if (target) return;
    const saved = loadRemembered();
    if (saved.preset) setPreset(saved.preset);
    if (saved.custom) setCustom(saved.custom);
    if (saved.typeFilter) setTypeFilter(saved.typeFilter);
    if (saved.hidden) setHidden(saved.hidden);
  }, [target]);
  useEffect(() => {
    if (target) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ preset, custom, typeFilter, hidden }),
      );
    } catch {
      // Storage can be blocked; the calendar simply forgets its setup.
    }
  }, [preset, custom, typeFilter, hidden, target]);

  // Arrow keys move the window a day (Shift: a week); T returns to today.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        target?.closest(
          'input, textarea, select, [role="dialog"], [role="listbox"], [contenteditable="true"]',
        )
      )
        return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = event.shiftKey ? 7 : 1;
        setStart((current) => addDays(current, event.key === 'ArrowLeft' ? -step : step));
      } else if (event.key === 't' || event.key === 'T') {
        setStart(addDays(todayIso(), -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dayCount =
    preset === 'custom' ? Math.min(MAX_DAYS, Math.max(1, Number(custom) || 1)) : Number(preset);
  const end = addDays(start, dayCount);
  const days = useMemo(() => windowDays(start, dayCount), [start, dayCount]);
  const showCancelled = !hidden.includes('cancelled');

  const board = useQuery({
    queryKey: ['dashboard', 'calendar-board', tenantId, propertyId, start, dayCount, showCancelled],
    queryFn: async () => {
      const response = await fetch(
        `${base}/bookings/board?from=${start}&to=${end}${showCancelled ? '&cancelled=1' : ''}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error(`Unable to load the calendar (${response.status}).`);
      return (await response.json()) as { items: ReservationRow[]; truncated: boolean };
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const catalog = useQuery({
    queryKey: ['dashboard', 'calendar-board-catalog', tenantId, propertyId],
    queryFn: async () => {
      const [typesResponse, roomsResponse] = await Promise.all([
        fetch(`${base}/room-types`, { credentials: 'include' }),
        fetch(`${base}/rooms`, { credentials: 'include' }),
      ]);
      if (!typesResponse.ok || !roomsResponse.ok) throw new Error('Unable to load rooms.');
      return {
        roomTypes: ((await typesResponse.json()) as RoomType[]).filter(
          (type) => type.roomCount > 0,
        ),
        rooms: (await roomsResponse.json()) as Room[],
      };
    },
  });
  const blocks = useQuery({
    queryKey: ['dashboard', 'availability-blocks', tenantId, propertyId],
    queryFn: () => fetchAvailabilityBlocks(tenantId, propertyId),
    enabled: true,
  });

  const rules = useBookingRulesEvaluation(tenantId, propertyId, { from: start, to: end });
  const selectedRules = useBookingRulesEvaluation(
    tenantId,
    propertyId,
    {
      startsOn: cell?.day,
      endsOn: cell ? addDays(cell.day, cell.nights) : undefined,
      roomTypeId: cell?.roomTypeId,
      roomId: cell?.room?.id,
    },
    Boolean(cell),
  );
  const today = rules.data?.today ?? todayIso();
  const disabledDates = new Set(rules.data?.disabledDates ?? []);
  const showRooms =
    Boolean(target) || bookingMode === 'INDIVIDUAL_ROOM_ONLY' || bookingMode === 'MIXED';
  const term = search.trim().toLowerCase();
  const allBookings = (board.data?.items ?? [])
    .filter(
      (row) =>
        !target ||
        (row.roomTypeId === target.roomTypeId && (!target.roomId || row.roomId === target.roomId)),
    )
    .map((row) => ({
      row,
      state: stayState(row, today),
    }));
  const visible = allBookings.filter(({ row, state }) => {
    if (hidden.includes(state)) return false;
    if (!term) return true;
    return [guestOf(row), row.externalReference, row.roomName ?? '', row.roomTypeName]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });
  const roomTypes = (catalog.data?.roomTypes ?? []).filter((type) =>
    target ? type.id === target.roomTypeId : typeFilter === 'all' || type.id === typeFilter,
  );
  const rooms = (catalog.data?.rooms ?? []).filter(
    (room) => !target?.roomId || room.id === target.roomId,
  );
  const stateCounts = STATES.map((state) => ({
    state,
    count: allBookings.filter((entry) => entry.state === state).length,
  }));

  // Figures from everything in the window that holds a room (cancelled ones never do).
  const holding = allBookings.filter(({ state }) => state !== 'cancelled');
  const totalUnits = target?.roomId
    ? 1
    : (catalog.data?.roomTypes ?? [])
        .filter((type) => !target || type.id === target.roomTypeId)
        .reduce((sum, type) => sum + type.roomCount, 0);
  const occupiedOn = (day: string, typeId?: string) =>
    holding.filter(
      ({ row }) =>
        (typeId ? row.roomTypeId === typeId : true) && occupiesNight(row.startsOn, row.endsOn, day),
    ).length;
  // Rooms taken out of sale by a block that night (a room counted once, however many blocks cover it).
  const blockedOn = (day: string, typeId?: string) => {
    const live = (blocks.data ?? []).filter((block) => block.startsOn <= day && day < block.endsOn);
    return (catalog.data?.roomTypes ?? [])
      .filter((type) => (typeId ? type.id === typeId : !target || type.id === target.roomTypeId))
      .reduce((sum, type) => {
        if (live.some((block) => block.all || block.roomTypeIds.includes(type.id)))
          return sum + (target?.roomId ? 1 : type.roomCount);
        const roomIds = new Set(live.flatMap((block) => block.roomIds));
        const covered = rooms.filter(
          (room) => room.roomTypeId === type.id && roomIds.has(room.id),
        ).length;
        return sum + Math.min(type.roomCount, covered);
      }, 0);
  };
  const freeOn = (day: string) => Math.max(0, totalUnits - occupiedOn(day) - blockedOn(day));
  const arrivals = holding.filter(({ row }) => row.startsOn === today).length;
  const departures = holding.filter(({ row }) => row.endsOn === today).length;
  const attention = allBookings.filter(({ state }) => state === 'needs_attention').length;

  const blockBars = (roomId: string | null, roomTypeId: string): AvailabilityBlock[] =>
    (blocks.data ?? []).filter(
      (block) =>
        block.all ||
        block.roomTypeIds.includes(roomTypeId) ||
        (roomId !== null && block.roomIds.includes(roomId)),
    );

  if (catalog.isError || board.isError)
    return (
      <ErrorPanel
        title="The calendar could not be loaded"
        description={(catalog.error ?? board.error)?.message}
        onRetry={() => {
          void catalog.refetch();
          void board.refetch();
        }}
      />
    );
  if (catalog.isPending || (board.isPending && !board.data))
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-3">
        <span className="sr-only">Loading the calendar…</span>
        <ListSkeleton rows={8} />
      </div>
    );
  if ((catalog.data?.roomTypes.length ?? 0) === 0)
    return (
      <EmptyPanel
        title="No rooms to show yet"
        description="Add room types and rooms in Accommodations, then the calendar fills in."
      />
    );

  const dayHref = (day: string, nights: number, room?: Room, roomTypeId?: string) =>
    href(
      tenantId,
      propertyId,
      `section=overview&tab=quick-booking&start=${day}&end=${addDays(day, nights)}${room ? `&roomTypeId=${room.roomTypeId}&roomId=${room.id}` : roomTypeId ? `&roomTypeId=${roomTypeId}` : ''}`,
    );
  const todayIndex = diffDays(start, today);
  const minWidth = LABEL_WIDTH + dayCount * MIN_DAY_WIDTH;
  const toggleState = (state: StayState) =>
    setHidden((current) =>
      current.includes(state) ? current.filter((entry) => entry !== state) : [...current, state],
    );
  const rowBackground = {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent calc(100% / ${dayCount} - 1px), var(--color-border, #e5e5e5) calc(100% / ${dayCount} - 1px), var(--color-border, #e5e5e5) calc(100% / ${dayCount}))`,
  };

  // Months in the window, for the thin row above the days.
  const months: Array<{ label: string; span: number }> = [];
  for (const day of days) {
    const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
      new Date(`${day}T00:00:00`),
    );
    const last = months[months.length - 1];
    if (last?.label === label) last.span += 1;
    else months.push({ label, span: 1 });
  }

  function selectDay(key: string, day: string, roomTypeId: string, room?: Room) {
    if ((!canCreateBooking && !canManageAvailability) || !rules.data || disabledDates.has(day))
      return;
    setCell((current) => {
      if (current?.key === key && current.day !== day) {
        const first = current.day < day ? current.day : day;
        const last = current.day < day ? day : current.day;
        return { key, day: first, room, roomTypeId, nights: diffDays(first, last) + 1 };
      }
      return current?.key === key && current.day === day
        ? null
        : { key, day, room, roomTypeId, nights: 1 };
    });
  }

  /** One line of the chart: label on the left, bars on the right. */
  const renderRow = ({
    key,
    label,
    sub,
    items,
    room,
    roomTypeId,
    showBlocks = true,
  }: {
    key: string;
    label: string;
    sub?: string;
    items: Array<{ row: ReservationRow; state: StayState }>;
    room?: Room;
    roomTypeId: string;
    showBlocks?: boolean;
  }) => {
    const packed = packLanes(
      items.map((entry) => ({ ...entry, startsOn: entry.row.startsOn, endsOn: entry.row.endsOn })),
    );
    const lanes = Math.max(1, ...packed.map((entry) => entry.lane + 1));
    const rowBlocks = showBlocks ? blockBars(room?.id ?? null, roomTypeId) : [];
    return (
      <div key={key} className="flex border-b">
        <div
          className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r bg-card px-3"
          style={{ width: LABEL_WIDTH, minHeight: lanes * LANE_HEIGHT }}
        >
          <span className="truncate text-xs font-semibold">{label}</span>
          {sub ? <span className="truncate text-[10px] text-muted-foreground">{sub}</span> : null}
        </div>
        <div
          className="relative flex-1 cursor-cell"
          style={{
            minWidth: dayCount * MIN_DAY_WIDTH,
            height: lanes * LANE_HEIGHT,
            ...rowBackground,
          }}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button')) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const index = Math.min(
              dayCount - 1,
              Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * dayCount)),
            );
            const day = days[index]!;
            selectDay(key, day, roomTypeId, room);
          }}
        >
          <div
            className="absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
          >
            {days.map((day) => (
              <button
                key={day}
                type="button"
                data-calendar-day={day}
                aria-label={`Select ${label} ${day}`}
                disabled={
                  !rules.data ||
                  disabledDates.has(day) ||
                  (!canCreateBooking && !canManageAvailability)
                }
                onClick={() => selectDay(key, day, roomTypeId, room)}
                className={cn(
                  'border-0 border-r border-solid border-border bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  disabledDates.has(day) && 'bg-muted/70 opacity-50',
                )}
              >
                <span className="sr-only">{day}</span>
              </button>
            ))}
          </div>
          {cell?.key === key &&
          diffDays(start, cell.day) >= 0 &&
          diffDays(start, cell.day) < dayCount ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0.5 rounded-md border-2 border-primary bg-primary/10"
              style={{
                left: `${(diffDays(start, cell.day) / dayCount) * 100}%`,
                width: `${(Math.min(cell.nights, dayCount - diffDays(start, cell.day)) / dayCount) * 100}%`,
              }}
            />
          ) : null}
          {todayIndex >= 0 && todayIndex < dayCount ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 bg-primary/5"
              style={{ left: `${(todayIndex / dayCount) * 100}%`, width: `${100 / dayCount}%` }}
            />
          ) : null}
          {rowBlocks.map((block) => {
            const geometry = blockGeometry(block.startsOn, block.endsOn, start, dayCount);
            if (!geometry) return null;
            const reasonLabel = block.reason
              ? (BLOCK_REASON_LABELS[block.reason as BlockReason] ?? block.reason)
              : 'Blocked';
            return (
              <button
                key={block.id}
                type="button"
                title={`${reasonLabel}${block.createdByEmail ? ` · ${block.createdByEmail}` : ''}`}
                disabled={!canManageAvailability || !stockKnown}
                onClick={() => {
                  if (stockKnown) setOpenBlock(block);
                }}
                className="absolute top-1 bottom-1 flex items-center gap-1 overflow-hidden rounded-md border border-dashed bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(0_0_0/0.06)_6px,rgb(0_0_0/0.06)_12px)] px-2 text-left text-[10px] font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                style={{ left: `${geometry.left * 100}%`, width: `${geometry.width * 100}%` }}
              >
                <Lock aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{reasonLabel}</span>
              </button>
            );
          })}
          {packed.map(({ item, lane }) => {
            const geometry = barGeometry(item.row.startsOn, item.row.endsOn, start, dayCount);
            if (!geometry) return null;
            const isNew = unseen.ids.has(item.row.id);
            return (
              <button
                key={item.row.id}
                type="button"
                title={`${guestOf(item.row)} · ${item.row.externalReference} · ${STAY_STATE_LABELS[item.state]}`}
                onClick={() => {
                  setSelected(item.row);
                  unseen.markSeen(item.row.id);
                }}
                className={cn(
                  'absolute flex flex-col justify-center overflow-hidden border px-2 text-left outline-none hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  stateStyle[item.state],
                  geometry.cutAtStart ? 'rounded-l-none' : 'rounded-l-md',
                  geometry.cutAtEnd ? 'rounded-r-none' : 'rounded-r-md',
                )}
                style={{
                  left: `${geometry.left * 100}%`,
                  width: `${geometry.width * 100}%`,
                  top: lane * LANE_HEIGHT + 4,
                  height: LANE_HEIGHT - 8,
                }}
              >
                <span className="flex items-center gap-1 truncate text-[11px] leading-4 font-semibold">
                  {isNew ? (
                    <span
                      aria-label="New"
                      className="size-1.5 shrink-0 rounded-full bg-amber-400"
                    />
                  ) : null}
                  {guestOf(item.row)}
                </span>
                <span className="truncate text-[10px] leading-3 opacity-80">
                  {item.row.externalReference}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-2xl font-extrabold tracking-tight">Reservations calendar</h2>
            <p className="m-0 text-sm text-muted-foreground">
              Every stay on a timeline. Click a bar to open it, or an empty day to add a
              reservation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={board.isFetching ? 'muted' : 'success'}
              className="rounded-full px-2 py-0 text-[11px]"
            >
              {board.isFetching ? 'Updating…' : 'Live'}
            </Badge>
            <IconButton label="Refresh" onClick={() => void board.refetch()}>
              <RefreshCw aria-hidden="true" />
            </IconButton>
            {canCreateBooking ? (
              <Button asChild>
                <a href={href(tenantId, propertyId, 'section=overview&tab=quick-booking')}>
                  <CirclePlus aria-hidden="true" /> Add reservation
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!stockKnown ? (
        <p role="note" className="text-sm text-muted-foreground">
          {capacityLabel}. Availability blocks are read-only here.
          {source.data === 'CLOCK_PMS' ? ' Manage them in Clock.' : ''}
        </p>
      ) : null}
      {!embedded ? (
        <section aria-label="Tonight" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile
            size="sm"
            label="Occupancy tonight"
            value={
              !stockKnown
                ? capacityLabel
                : totalUnits > 0
                  ? `${Math.round((occupiedOn(today) / totalUnits) * 100)}%`
                  : '—'
            }
            note={stockKnown ? `${occupiedOn(today)} of ${totalUnits} rooms` : undefined}
          />
          <StatTile
            size="sm"
            label="Available tonight"
            value={stockKnown ? freeOn(today) : capacityLabel}
            note={stockKnown ? 'Rooms free' : undefined}
          />
          <StatTile size="sm" label="Arrivals today" value={arrivals} />
          <StatTile size="sm" label="Departures today" value={departures} />
          <StatTile
            size="sm"
            label="Need attention"
            value={attention}
            tone={attention > 0 ? 'warning' : 'default'}
            note="In this window"
          />
        </section>
      ) : null}
      <div className="flex flex-col gap-2" aria-label="Calendar booking rules">
        <p className="m-0 text-sm text-muted-foreground">
          Stay rules: minimum{' '}
          {selectedRules.data?.minStayNights ?? rules.data?.minStayNights ?? 'not set'} nights;
          maximum {selectedRules.data?.maxStayNights ?? rules.data?.maxStayNights ?? 'not set'}{' '}
          nights.
        </p>
        {rules.isError ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {rules.error.message}
          </p>
        ) : null}
        {disabledDates.size > 0 && rules.data?.pastDateMessage ? (
          <p className="m-0 text-xs text-muted-foreground">
            {rules.data.pastDateMessage} Past dates are disabled.
          </p>
        ) : null}
      </div>
      <Card className="min-w-0 gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Button variant="outline" size="sm" onClick={() => setStart(addDays(todayIso(), -1))}>
            Today
          </Button>
          <IconButton label="Earlier" onClick={() => setStart(addDays(start, -dayCount))}>
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <IconButton label="Later" onClick={() => setStart(addDays(start, dayCount))}>
            <ChevronRight aria-hidden="true" />
          </IconButton>
          <CalendarPicker
            label="Go to date"
            mode="single"
            value={{ start, end: null }}
            onChange={(selection) => selection.start && setStart(selection.start)}
            className="w-40"
          />
          <SegmentedControl<Preset>
            label="Days shown"
            value={preset}
            onChange={setPreset}
            options={[
              { value: '7', label: '7 days' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          {preset === 'custom' ? (
            <div className="flex items-center gap-1.5 text-sm">
              <Input
                aria-label="Number of days"
                inputMode="numeric"
                className="w-16"
                value={custom}
                onChange={(event) => setCustom(cleanDigits(event.target.value).slice(0, 2))}
                onBlur={() =>
                  setCustom(String(Math.min(MAX_DAYS, Math.max(1, Number(custom) || 1))))
                }
              />
              <span className="text-muted-foreground">days (1–{MAX_DAYS})</span>
            </div>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SearchInput
              aria-label="Search guest, reference or room"
              placeholder="Search guest or room"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-56"
            />
            <Select disabled={Boolean(target)} value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger aria-label="Room type" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All room types</SelectItem>
                {(catalog.data?.roomTypes ?? []).map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
          role="group"
          aria-label="Show these stays"
        >
          <span className="text-[11px] font-semibold text-muted-foreground">Show:</span>
          {stateCounts.map(({ state, count }) => {
            const on = !hidden.includes(state);
            return (
              <button
                key={state}
                type="button"
                aria-pressed={on}
                onClick={() => toggleState(state)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  on
                    ? 'bg-card text-foreground'
                    : 'bg-transparent text-muted-foreground opacity-60',
                )}
              >
                <span className={cn('size-2.5 rounded-sm border', stateStyle[state])} />
                {STAY_STATE_LABELS[state]}
                <span className="text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </div>

        <div
          className={cn(
            'overflow-x-auto',
            embedded && 'max-h-[42vh] overflow-y-auto',
            board.isFetching && 'opacity-80 transition-opacity',
          )}
        >
          <div style={{ minWidth }}>
            <div className="flex border-b bg-muted/60">
              <div
                className="sticky left-0 z-30 shrink-0 border-r bg-muted"
                style={{ width: LABEL_WIDTH }}
              />
              <div
                className="grid flex-1"
                style={{ gridTemplateColumns: months.map((month) => `${month.span}fr`).join(' ') }}
              >
                {months.map((month) => (
                  <div
                    key={month.label}
                    className="truncate border-l px-2 py-1 text-[11px] font-bold"
                  >
                    {month.label}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex border-b bg-muted">
              <div
                className="sticky left-0 z-30 flex shrink-0 items-center border-r bg-muted px-3 text-[11px] font-semibold text-muted-foreground"
                style={{ width: LABEL_WIDTH }}
              >
                {showRooms ? 'Room' : 'Room type'}
              </div>
              <div
                className="grid flex-1"
                style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
              >
                {days.map((day) => {
                  const date = new Date(`${day}T00:00:00`);
                  const isToday = day === today;
                  const weekend = date.getDay() === 0 || date.getDay() === 6;
                  return (
                    <div
                      key={day}
                      className={cn(
                        'flex flex-col items-center justify-center border-l py-1.5 text-center',
                        weekend && 'bg-muted-foreground/5',
                        isToday && 'bg-primary text-primary-foreground',
                      )}
                    >
                      <span className="text-[10px] leading-3 uppercase opacity-80">
                        {new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(date)}
                      </span>
                      <span className="text-sm leading-5 font-bold">{date.getDate()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex border-b bg-card">
              <div
                className="sticky left-0 z-30 flex shrink-0 items-center border-r bg-card px-3 text-[11px] font-semibold text-muted-foreground"
                style={{ width: LABEL_WIDTH }}
              >
                {stockKnown ? 'Rooms free' : 'Capacity'}
              </div>
              <div
                className="grid flex-1"
                style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
              >
                {days.map((day) => {
                  const free = freeOn(day);
                  return (
                    <div
                      key={day}
                      className={cn(
                        'border-l py-1 text-center text-[11px] font-semibold',
                        !stockKnown
                          ? 'text-muted-foreground'
                          : free === 0
                            ? 'text-destructive'
                            : free <= 2
                              ? 'text-warning'
                              : 'text-muted-foreground',
                      )}
                    >
                      {stockKnown ? free : <span title={capacityLabel}>Unknown</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {roomTypes.map((type) => {
              const typeEntries = visible.filter(({ row }) => row.roomTypeId === type.id);
              const typeRooms = rooms.filter((room) => room.roomTypeId === type.id);
              const unassigned = target?.roomId
                ? []
                : typeEntries.filter(({ row }) => !row.roomId || !showRooms);
              const isCollapsed = collapsed.includes(type.id);
              return (
                <div key={type.id}>
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((current) =>
                        current.includes(type.id)
                          ? current.filter((id) => id !== type.id)
                          : [...current, type.id],
                      )
                    }
                    className="sticky left-0 flex w-full items-center gap-2 border-b bg-muted/60 px-3 py-1.5 text-left text-xs font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        'size-4 shrink-0 transition-transform',
                        isCollapsed && '-rotate-90',
                      )}
                    />
                    {type.name}
                    <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">
                      {stockKnown
                        ? `${occupiedOn(today, type.id)} / ${target?.roomId ? 1 : type.roomCount} tonight`
                        : capacityLabel}
                    </Badge>
                  </button>
                  {isCollapsed ? null : (
                    <>
                      {showRooms
                        ? typeRooms.map((room) =>
                            renderRow({
                              key: room.id,
                              label: room.name,
                              room,
                              roomTypeId: type.id,
                              items: typeEntries.filter(({ row }) => row.roomId === room.id),
                            }),
                          )
                        : null}
                      {unassigned.length > 0 || !showRooms
                        ? renderRow({
                            key: `${type.id}-open`,
                            label: showRooms ? 'Not assigned' : 'Reservations',
                            sub: showRooms ? 'No room chosen yet' : `${type.roomCount} rooms`,
                            roomTypeId: type.id,
                            items: unassigned,
                            showBlocks: !showRooms,
                          })
                        : null}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {cell ? (
          <div className="flex flex-wrap items-center gap-3 border-t bg-primary/5 px-4 py-3 text-sm">
            <span className="font-semibold">
              {cell.room ? `${cell.room.name} · ` : ''}
              {new Intl.DateTimeFormat('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              }).format(new Date(`${cell.day}T00:00:00`))}
            </span>
            <span className="text-muted-foreground">for</span>
            <NumberStepper
              label="Nights"
              min={1}
              max={selectedRules.data?.maxStayNights ?? rules.data?.maxStayNights ?? undefined}
              value={cell.nights}
              onChange={(nights) => setCell({ ...cell, nights })}
              className="w-32"
            />
            <span className="text-muted-foreground">{cell.nights === 1 ? 'night' : 'nights'}</span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCell(null)}>
                Cancel
              </Button>
              {canManageAvailability && stockKnown ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selectedRules.data?.block.valid || selectedRules.isFetching}
                  onClick={() => {
                    if (stockKnown) setBlocking(true);
                  }}
                >
                  <Lock aria-hidden="true" /> Block these nights
                </Button>
              ) : null}
              {canCreateBooking ? (
                selectedRules.data?.booking.valid && !selectedRules.isFetching ? (
                  <Button size="sm" asChild>
                    <a href={dayHref(cell.day, cell.nights, cell.room, cell.roomTypeId)}>
                      <CirclePlus aria-hidden="true" />
                      {embedded ? 'New booking' : 'Add reservation'}
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" disabled>
                    <CirclePlus aria-hidden="true" />
                    {embedded ? 'New booking' : 'Add reservation'}
                  </Button>
                )
              ) : null}
            </div>
            {selectedRules.isError ? (
              <p role="alert" className="m-0 w-full text-sm text-destructive">
                {selectedRules.error.message}
              </p>
            ) : null}
            {[
              ...new Set(
                [
                  ...(canCreateBooking ? (selectedRules.data?.booking.errors ?? []) : []),
                  ...(canManageAvailability ? (selectedRules.data?.block.errors ?? []) : []),
                ].map((error) => error.message),
              ),
            ].map((message) => (
              <p key={message} role="alert" className="m-0 w-full text-sm text-destructive">
                {message}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-dashed bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,rgb(0_0_0/0.12)_3px,rgb(0_0_0/0.12)_6px)]" />
            Blocked
          </span>
          {board.data?.truncated ? (
            <span className="font-semibold text-warning">
              Only the first 1000 reservations are shown. Narrow the dates.
            </span>
          ) : null}
          <span className="ml-auto">
            {board.dataUpdatedAt
              ? `Updated ${new Date(board.dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
              : ''}
          </span>
        </div>
      </Card>

      {cell && canManageAvailability && stockKnown ? (
        <BlockDialog
          open={blocking}
          onOpenChange={(open) => {
            setBlocking(open);
            if (!open) setCell(null);
          }}
          tenantId={tenantId}
          propertyId={propertyId}
          startsOn={cell.day}
          endsOn={addDays(cell.day, cell.nights)}
          target={
            cell.room
              ? {
                  label: `Room ${cell.room.name} · ${cell.room.roomTypeName}`,
                  roomId: cell.room.id,
                  roomTypeId: cell.roomTypeId,
                }
              : {
                  label: `Every ${(catalog.data?.roomTypes ?? []).find((type) => type.id === cell.roomTypeId)?.name ?? 'room'}`,
                  roomTypeId: cell.roomTypeId,
                }
          }
        />
      ) : null}

      <ConfirmDialog
        open={openBlock !== null}
        onOpenChange={(open) => {
          if (!open) setOpenBlock(null);
        }}
        title="This block"
        description="Rooms covered by it can be sold again once it is removed."
        confirmLabel={openBlock?.inventoryReference ? 'End or cancel block' : 'Remove block'}
        reasonLabel={openBlock?.inventoryReference ? 'Reason for reopening' : undefined}
        reasonRequired={Boolean(openBlock?.inventoryReference)}
        destructive
        onConfirm={async (endReason) => {
          if (!openBlock) return;
          const isV2 = Boolean(openBlock.inventoryReference);
          if (isV2) {
            await blockWriter.current(
              `${base}/inventory/blocks/${openBlock.id}/${openBlock.startsOn > today ? 'cancel' : 'end'}`,
              'POST',
              { version: openBlock.version, endReason },
            );
          } else {
            const response = await fetch(`${base}/availability-blocks/${openBlock.id}`, {
              method: 'DELETE',
              credentials: 'include',
            });
            if (!response.ok) throw new Error('The block could not be removed.');
          }
          await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        }}
      >
        {openBlock ? (
          <DetailList
            items={[
              {
                label: 'Reason',
                value: openBlock.reason
                  ? (BLOCK_REASON_LABELS[openBlock.reason as BlockReason] ?? openBlock.reason)
                  : 'Not recorded',
              },
              { label: 'From', value: openBlock.startsOn },
              { label: 'Available again', value: openBlock.endsOn },
              { label: 'Reference', value: openBlock.reference },
              { label: 'Note', value: openBlock.note },
              { label: 'Created by', value: openBlock.createdByEmail },
            ]}
          />
        ) : null}
      </ConfirmDialog>

      <ReservationSheet
        row={selected}
        tenantId={tenantId}
        propertyId={propertyId}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
