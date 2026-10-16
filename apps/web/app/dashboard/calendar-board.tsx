'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CirclePlus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { IconButton } from '../../components/ui/icon-button';
import { SearchInput } from '../../components/ui/search-input';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { StatTile } from '../../components/ui/stat-tile';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import {
  addDays,
  barGeometry,
  diffDays,
  occupiesNight,
  packLanes,
  windowDays,
} from '../../lib/calendar-board';
import { ATTENTION_STATUSES, bookingStatusDisplay } from '../../lib/reservation-display';
import { cn } from '../../lib/utils';
import { fetchAvailabilityBlocks, type AvailabilityBlock } from './calendar';
import { ReservationSheet, type ReservationRow } from './reservations-page';
import { useUnseenBookings } from './unseen-bookings';

type RoomType = { id: string; name: string; roomCount: number };
type Room = { id: string; name: string; roomTypeId: string; roomTypeName: string };
type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';

const LABEL_WIDTH = 208;
const DAY_WIDTH = 60;
const LANE_HEIGHT = 40;

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const barTone: Record<string, string> = {
  success: 'border-success/40 bg-success-surface text-success',
  warning: 'border-warning/40 bg-warning-surface text-warning',
  danger: 'border-destructive/40 bg-destructive-surface text-destructive',
  info: 'border-info/40 bg-info-surface text-info',
  muted: 'border-border bg-muted text-muted-foreground',
  secondary: 'border-border bg-secondary text-secondary-foreground',
};

const guestOf = (row: ReservationRow) =>
  [row.guestFirstName, row.guestLastName].filter(Boolean).join(' ') || row.guestEmail || 'Guest';

function href(tenantId: string, propertyId: string, extra: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&${extra}`;
}

type StatusFilter = 'all' | 'confirmed' | 'pending' | 'attention';

/**
 * The reservations tape chart: one row per room (or one lane per room type when rooms are not
 * assigned), a column per day and a bar per stay. Read-only for now: click a bar to open the
 * reservation, click an empty day to start a reservation for it.
 */
export function CalendarBoard({
  tenantId,
  propertyId,
  bookingMode,
  canManageAvailability = false,
}: {
  tenantId: string;
  propertyId: string;
  bookingMode?: BookingMode;
  canManageAvailability?: boolean;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const today = todayIso();
  const [start, setStart] = useState(() => addDays(todayIso(), -1));
  const [dayCount, setDayCount] = useState<7 | 14 | 30>(14);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState<ReservationRow | null>(null);
  const unseen = useUnseenBookings(tenantId, propertyId);
  const end = addDays(start, dayCount);
  const days = useMemo(() => windowDays(start, dayCount), [start, dayCount]);

  const board = useQuery({
    queryKey: ['dashboard', 'calendar-board', tenantId, propertyId, start, dayCount],
    queryFn: async () => {
      const response = await fetch(`${base}/bookings/board?from=${start}&to=${end}`, { credentials: 'include' });
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
        roomTypes: ((await typesResponse.json()) as RoomType[]).filter((type) => type.roomCount > 0),
        rooms: (await roomsResponse.json()) as Room[],
      };
    },
  });
  const blocks = useQuery({
    queryKey: ['dashboard', 'availability-blocks', tenantId, propertyId],
    queryFn: () => fetchAvailabilityBlocks(tenantId, propertyId),
    enabled: canManageAvailability,
  });

  const showRooms = bookingMode === 'INDIVIDUAL_ROOM_ONLY' || bookingMode === 'MIXED';
  const term = search.trim().toLowerCase();
  const matches = (row: ReservationRow) => {
    if (status === 'confirmed' && row.status !== 'CONFIRMED') return false;
    if (status === 'pending' && row.status !== 'PAYMENT_PENDING') return false;
    if (status === 'attention' && !(ATTENTION_STATUSES as readonly string[]).includes(row.status)) return false;
    if (!term) return true;
    return [guestOf(row), row.externalReference, row.roomName ?? '', row.roomTypeName].join(' ').toLowerCase().includes(term);
  };

  const bookings = (board.data?.items ?? []).filter(matches);
  const roomTypes = (catalog.data?.roomTypes ?? []).filter((type) => typeFilter === 'all' || type.id === typeFilter);
  const rooms = catalog.data?.rooms ?? [];
  const allBookings = board.data?.items ?? [];

  // Figures for the strip: tonight, from everything in the window (not the filtered rows).
  const totalUnits = (catalog.data?.roomTypes ?? []).reduce((sum, type) => sum + type.roomCount, 0);
  const occupiedTonight = allBookings.filter((row) => occupiesNight(row.startsOn, row.endsOn, today)).length;
  const arrivals = allBookings.filter((row) => row.startsOn === today).length;
  const departures = allBookings.filter((row) => row.endsOn === today).length;
  const attention = allBookings.filter((row) => (ATTENTION_STATUSES as readonly string[]).includes(row.status)).length;

  const blockBars = (roomId: string | null, roomTypeId: string): AvailabilityBlock[] =>
    (blocks.data ?? []).filter(
      (block) =>
        block.all || block.roomTypeIds.includes(roomTypeId) || (roomId !== null && block.roomIds.includes(roomId)),
    );

  const headerStatus = board.isFetching ? 'Updating…' : board.dataUpdatedAt ? 'Live' : '';

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
  if (roomTypes.length === 0 && (catalog.data?.roomTypes.length ?? 0) === 0)
    return (
      <EmptyPanel
        title="No rooms to show yet"
        description="Add room types and rooms in Accommodations, then the calendar fills in."
      />
    );

  const dayHref = (day: string, room?: Room) =>
    href(
      tenantId,
      propertyId,
      `section=overview&tab=quick-booking&start=${day}&end=${addDays(day, 1)}${room ? `&roomTypeId=${room.roomTypeId}&roomId=${room.id}` : ''}`,
    );
  const gridWidth = dayCount * DAY_WIDTH;
  const todayIndex = diffDays(start, today);

  const rowBackground = {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent calc(100% / ${dayCount} - 1px), var(--color-border, #e5e5e5) calc(100% / ${dayCount} - 1px), var(--color-border, #e5e5e5) calc(100% / ${dayCount}))`,
  };

  /** One line of the chart: label on the left, bars on the right. */
  const renderRow = ({
    key,
    label,
    sub,
    items,
    room,
    roomTypeId,
    muted = false,
  }: {
    key: string;
    label: string;
    sub?: string;
    items: ReservationRow[];
    room?: Room;
    roomTypeId: string;
    muted?: boolean;
  }) => {
    const packed = packLanes(items);
    const lanes = Math.max(1, ...packed.map((entry) => entry.lane + 1));
    const rowBlocks = blockBars(room?.id ?? null, roomTypeId).filter(() => !muted);
    return (
      <div key={key} className="flex border-b" style={{ width: LABEL_WIDTH + gridWidth }}>
        <div
          className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r bg-card px-3"
          style={{ width: LABEL_WIDTH, minHeight: lanes * LANE_HEIGHT }}
        >
          <span className="truncate text-xs font-semibold">{label}</span>
          {sub ? <span className="truncate text-[10px] text-muted-foreground">{sub}</span> : null}
        </div>
        <div
          className="relative cursor-cell"
          style={{ width: gridWidth, height: lanes * LANE_HEIGHT, ...rowBackground }}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button')) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const index = Math.min(dayCount - 1, Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * dayCount)));
            window.location.assign(dayHref(days[index]!, room));
          }}
        >
          {todayIndex >= 0 && todayIndex < dayCount ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 bg-primary/5"
              style={{ left: `${(todayIndex / dayCount) * 100}%`, width: `${100 / dayCount}%` }}
            />
          ) : null}
          {rowBlocks.map((block) => {
            const geometry = barGeometry(block.startsOn, block.endsOn, start, dayCount);
            if (!geometry) return null;
            return (
              <div
                key={block.id}
                title="Blocked"
                className="pointer-events-none absolute top-1 bottom-1 flex items-center rounded-md border border-dashed bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(0_0_0/0.06)_6px,rgb(0_0_0/0.06)_12px)] px-2 text-[10px] font-semibold text-muted-foreground"
                style={{ left: `${geometry.left * 100}%`, width: `${geometry.width * 100}%` }}
              >
                Blocked
              </div>
            );
          })}
          {packed.map(({ item, lane }) => {
            const geometry = barGeometry(item.startsOn, item.endsOn, start, dayCount);
            if (!geometry) return null;
            const tone = bookingStatusDisplay(item.status).tone;
            const isNew = unseen.ids.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                title={`${guestOf(item)} · ${item.externalReference} · ${bookingStatusDisplay(item.status).label}`}
                onClick={() => {
                  setSelected(item);
                  unseen.markSeen(item.id);
                }}
                className={cn(
                  'absolute flex flex-col justify-center overflow-hidden border px-2 text-left outline-none hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  barTone[tone] ?? barTone.muted,
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
                  {isNew ? <span aria-label="New" className="size-1.5 shrink-0 rounded-full bg-amber-400" /> : null}
                  {guestOf(item)}
                </span>
                <span className="truncate text-[10px] leading-3 opacity-80">{item.externalReference}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-2xl font-extrabold tracking-tight">Reservations calendar</h2>
          <p className="m-0 text-sm text-muted-foreground">
            Every stay on a timeline. Click a bar to open it, or an empty day to add a reservation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {headerStatus ? (
            <Badge variant={board.isFetching ? 'muted' : 'success'} className="rounded-full px-2 py-0 text-[11px]">
              {headerStatus}
            </Badge>
          ) : null}
          <IconButton label="Refresh" onClick={() => void board.refetch()}>
            <RefreshCw aria-hidden="true" />
          </IconButton>
          <Button asChild>
            <a href={href(tenantId, propertyId, 'section=overview&tab=quick-booking')}>
              <CirclePlus aria-hidden="true" /> Add reservation
            </a>
          </Button>
        </div>
      </div>

      <section aria-label="Tonight" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          size="sm"
          label="Occupancy tonight"
          value={totalUnits > 0 ? `${Math.round((occupiedTonight / totalUnits) * 100)}%` : '—'}
          note={`${occupiedTonight} of ${totalUnits} rooms`}
        />
        <StatTile size="sm" label="Available tonight" value={Math.max(0, totalUnits - occupiedTonight)} note="Rooms free" />
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

      <Card className="gap-0 py-0">
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
          <span className="px-1 text-sm font-semibold">
            {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${start}T00:00:00`))} –{' '}
            {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
              new Date(`${addDays(end, -1)}T00:00:00`),
            )}
          </span>
          <SegmentedControl<'7' | '14' | '30'>
            label="Days shown"
            value={String(dayCount) as '7' | '14' | '30'}
            onChange={(value) => setDayCount(Number(value) as 7 | 14 | 30)}
            options={[
              { value: '7', label: '7 days' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
            ]}
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SearchInput
              aria-label="Search guest, reference or room"
              placeholder="Search guest or room"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-56"
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
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
            <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
              <SelectTrigger aria-label="Status" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="pending">Awaiting payment</SelectItem>
                <SelectItem value="attention">Needs attention</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className={cn('overflow-x-auto', board.isFetching && 'opacity-80 transition-opacity')}>
          <div style={{ width: LABEL_WIDTH + gridWidth }}>
            <div className="sticky top-0 z-20 flex border-b bg-muted">
              <div
                className="sticky left-0 z-30 flex shrink-0 items-center border-r bg-muted px-3 text-[11px] font-semibold text-muted-foreground"
                style={{ width: LABEL_WIDTH }}
              >
                {showRooms ? 'Room' : 'Room type'}
              </div>
              <div className="grid" style={{ width: gridWidth, gridTemplateColumns: `repeat(${dayCount}, 1fr)` }}>
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

            {roomTypes.map((type) => {
              const typeBookings = bookings.filter((row) => row.roomTypeId === type.id);
              const typeRooms = rooms.filter((room) => room.roomTypeId === type.id);
              const tonight = allBookings.filter(
                (row) => row.roomTypeId === type.id && occupiesNight(row.startsOn, row.endsOn, today),
              ).length;
              const unassigned = typeBookings.filter((row) => !row.roomId || !showRooms);
              return (
                <div key={type.id}>
                  <div
                    className="sticky left-0 flex items-center gap-2 border-b bg-muted/60 px-3 py-1.5 text-xs font-bold"
                    style={{ width: LABEL_WIDTH + gridWidth }}
                  >
                    {type.name}
                    <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">
                      {tonight} / {type.roomCount} tonight
                    </Badge>
                  </div>
                  {showRooms
                    ? typeRooms.map((room) =>
                        renderRow({
                          key: room.id,
                          label: room.name,
                          room,
                          roomTypeId: type.id,
                          items: typeBookings.filter((row) => row.roomId === room.id),
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
                        muted: showRooms,
                      })
                    : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <Legend className={barTone.success!} label="Confirmed" />
          <Legend className={barTone.warning!} label="Awaiting payment" />
          <Legend className={barTone.danger!} label="Needs attention" />
          <Legend className="border-dashed bg-muted" label="Blocked" />
          {board.data?.truncated ? (
            <span className="font-semibold text-warning">Only the first 1000 reservations are shown. Narrow the dates.</span>
          ) : null}
          <span className="ml-auto">
            {board.dataUpdatedAt ? `Updated ${new Date(board.dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        </div>
      </Card>

      <ReservationSheet
        row={selected}
        tenantId={tenantId}
        propertyId={propertyId}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-3 rounded-sm border', className)} />
      {label}
    </span>
  );
}
