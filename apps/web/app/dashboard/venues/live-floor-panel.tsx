'use client';

import { useQuery, useQueries } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { CalendarPicker } from '../../../components/ui/calendar-picker';
import { TimeStrip } from '../../../components/ui/time-strip';
import { Button } from '../../../components/ui/button';
import { FloorMap } from '../../../components/ui/floor-map';
import { TabBar } from '../../../components/ui/tab-bar';
import { cn } from '../../../lib/utils';
import { reservationApi } from './reservation-api';
import { dateInZone, instantAt, TABLE_STATE_DISPLAY, timeInZone } from './reservation-display';
import { venueApi } from './venue-api';
import { serviceTimeColumns, selectedTimeRuns } from './service-time-columns';
import { seatsText } from './seats';

/**
 * The floor plan as it is (or will be) at a chosen time: each table is coloured by its state, and
 * service columns select moments or periods through the day. "Now" follows the clock.
 */
export function LiveFloorPanel({
  tenantId,
  venueId,
  timezone,
}: {
  tenantId: string;
  venueId: string;
  timezone: string;
}) {
  const today = dateInZone(timezone);
  const [date, setDate] = useState(today);
  const [times, setTimes] = useState<number[]>([]);
  const [anchorTime, setAnchorTime] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const services = useQuery({
    queryKey: ['venue-services', tenantId, venueId],
    queryFn: () => venueApi.listServices(tenantId, venueId),
  });
  const columns = serviceTimeColumns(date, services.data ?? []);
  const validTimes = times.filter((value) => columns.some((column) => column.value === value));
  const chosen = validTimes.length
    ? validTimes
    : date !== today && columns.length
      ? [columns[0].value]
      : [];
  const runs = selectedTimeRuns(chosen, columns);
  const periods = chosen.length > 1;
  const requests: Array<string | { from: string; to: string } | undefined> = periods
    ? runs.map((run) => ({
        from: instantAt(date, run.from, timezone).toISOString(),
        to: instantAt(date, run.to, timezone).toISOString(),
      }))
    : [
        chosen.length || date !== today
          ? instantAt(date, chosen[0] ?? 0, timezone).toISOString()
          : undefined,
      ];
  const floors = useQueries({
    queries: requests.map((request) => ({
      queryKey: ['venue-floor', tenantId, venueId, request ?? 'now'],
      queryFn: () => reservationApi.floor(tenantId, venueId, request),
      refetchInterval: chosen.length === 0 ? 30_000 : (false as const),
    })),
  });
  const floor = floors[0];
  if (services.isPending || floors.some((floor) => floor.isPending))
    return <p className="text-sm text-muted-foreground">Loading the floor…</p>;
  if (services.isError || floors.some((floor) => floor.isError))
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {services.error?.message ?? floors.find((floor) => floor.error)?.error?.message}
        </AlertDescription>
      </Alert>
    );

  const areas = floor.data!.areas.map((area) => ({
    ...area,
    tables: area.tables.map((table) => {
      const versions = floors.flatMap(
        (floor) =>
          floor.data?.areas
            .find((a) => a.id === area.id)
            ?.tables.filter((t) => t.id === table.id) ?? [],
      );
      const bookings = [
        ...new Map(
          versions
            .flatMap((t) => [...(t.bookings ?? []), ...(t.current ? [t.current] : [])])
            .map((b) => [b.id, b]),
        ).values(),
      ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const rank = { free: 0, reserved: 1, seated: 2, finishing: 3, overrun: 4, blocked: 5 };
      const state = versions.reduce(
        (best, t) => (rank[t.status] > rank[best] ? t.status : best),
        table.status,
      );
      return {
        ...table,
        bookings,
        status: periods && state === 'free' && bookings.length ? ('reserved' as const) : state,
      };
    }),
  }));
  if (areas.length === 0)
    return (
      <Alert variant="info">
        <AlertDescription>Add an area and tables in the Layout tab first.</AlertDescription>
      </Alert>
    );
  const area = areas.find((a) => a.id === areaId) ?? areas[0]!;
  const shown = timeInZone(floor.data!.at, timezone);
  const selected = area.tables.find((t) => t.id === selectedId);

  return (
    <div className="space-y-4">
      {areas.length > 1 ? (
        <TabBar
          label="Areas"
          tabs={areas.map((a) => ({ id: a.id, label: a.name }))}
          current={area.id}
          onSelect={setAreaId}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <CalendarPicker
          label="Floor date"
          mode="single"
          value={{ start: date, end: date }}
          onChange={(value) => {
            if (value.start) {
              setDate(value.start);
              setTimes([]);
              setAnchorTime(null);
            }
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDate(today);
            setTimes([]);
            setAnchorTime(null);
          }}
        >
          Now
        </Button>
        <span className="text-sm">
          {chosen.length ? (periods ? `${chosen.length} selected times` : shown) : `Now (${shown})`}
        </span>
      </div>
      {columns.length ? (
        <TimeStrip
          key={date}
          columns={columns}
          selected={chosen}
          onChange={setTimes}
          initialAnchor={anchorTime}
          onAnchorChange={setAnchorTime}
        />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Closed on this day.
        </p>
      )}

      <ul className="m-0 flex list-none flex-wrap gap-2 p-0 text-xs" aria-label="Colours">
        {Object.values(TABLE_STATE_DISPLAY).map((state) => (
          <li key={state.label} className={cn('rounded-full border px-2 py-0.5', state.tone)}>
            {state.label}
          </li>
        ))}
      </ul>

      <FloorMap
        label={`${area.name} at ${shown}`}
        width={area.mapWidth}
        height={area.mapHeight}
        editable={false}
        selectedId={selectedId}
        onMove={() => undefined}
        onSelect={setSelectedId}
        tables={area.tables.map((t) => ({
          id: t.id,
          label: t.label,
          seats: seatsText(t.minSeats, t.maxSeats),
          caption: t.current ? `${t.current.guestName} · ${t.current.partySize}` : undefined,
          x: t.mapX,
          y: t.mapY,
          w: t.mapWidth,
          h: t.mapHeight,
          shape: t.shape,
          tone: TABLE_STATE_DISPLAY[t.status].tone,
        }))}
      />

      {selected ? (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <p className="font-semibold">
            {selected.label} · {seatsText(selected.minSeats, selected.maxSeats)} ·{' '}
            {TABLE_STATE_DISPLAY[selected.status].label}
          </p>
          {periods ? (
            selected.bookings?.length ? (
              <ul className="list-disc pl-4">
                {selected.bookings.map((booking) => (
                  <li key={booking.id}>
                    {booking.guestName}, {booking.partySize} guests,{' '}
                    {timeInZone(booking.startsAt, timezone)}-{timeInZone(booking.endsAt, timezone)}{' '}
                    ({booking.status.replaceAll('_', ' ')})
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {selected.status === 'free'
                  ? 'Free for the whole selected period.'
                  : TABLE_STATE_DISPLAY[selected.status].label}
              </p>
            )
          ) : (
            <>
              {selected.current ? (
                <p>
                  Now: {selected.current.guestName}, {selected.current.partySize} guests,{' '}
                  {timeInZone(selected.current.startsAt, timezone)}-
                  {timeInZone(selected.current.endsAt, timezone)}
                </p>
              ) : null}
              {selected.next ? (
                <p className="text-muted-foreground">
                  Next: {selected.next.guestName} at {timeInZone(selected.next.startsAt, timezone)}
                </p>
              ) : !selected.current ? (
                <p className="text-muted-foreground">Nothing booked.</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
