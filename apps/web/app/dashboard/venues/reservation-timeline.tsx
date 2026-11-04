'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { cn } from '../../../lib/utils';
import type { Reservation } from './reservation-api';
import {
  dayOfInstant,
  dateInZone,
  instantAt,
  minutesOf,
  STATUS_DISPLAY,
  timeInZone,
} from './reservation-display';
import { serviceTimeColumns } from './service-time-columns';
import { venueApi, type VenueTable } from './venue-api';
export type BookingPrefill = {
  date: string;
  time: string;
  tableId: string;
  areaId: string;
  partySize: number;
};
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** A quarter-hour calendar with actual service spans, table groups and duration-sized bookings. */
export function ReservationTimeline({
  tenantId,
  venueId,
  timezone,
  date,
  reservations,
  onEmpty,
  onBooking,
}: {
  tenantId: string;
  venueId: string;
  timezone: string;
  date: string;
  reservations: readonly Reservation[];
  onEmpty?: (prefill: BookingPrefill) => void;
  onBooking?: (reservation: Reservation) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const layout = useQuery({
    queryKey: ['venue-layout', tenantId, venueId],
    queryFn: () => venueApi.getLayout(tenantId, venueId),
  });
  const services = useQuery({
    queryKey: ['venue-services', tenantId, venueId],
    queryFn: () => venueApi.listServices(tenantId, venueId),
  });
  useEffect(() => {
    if (!layout.data || !services.data || !scroll.current) return;
    const columns = serviceTimeColumns(date, services.data);
    const now = new Date().toISOString();
    const current = minutesOf(timeInZone(now, timezone));
    scroll.current.scrollLeft =
      date === dayOfInstant(now, timezone) && columns.length
        ? Math.max(0, Math.floor((current - columns[0].value) / 15) * 64)
        : 0;
  }, [date, timezone, layout.data, services.data]);
  if (layout.isPending || services.isPending)
    return <p className="text-sm text-muted-foreground">Loading calendar...</p>;
  if (layout.error || services.error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{(layout.error ?? services.error)?.message}</AlertDescription>
      </Alert>
    );
  const open = serviceTimeColumns(date, services.data!);
  if (!open.length)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Closed on this day.
      </p>
    );
  const minutesFrom = (iso: string) =>
    Math.round(
      (Date.parse(`${dayOfInstant(iso, timezone)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
        86400000,
    ) *
      1440 +
    minutesOf(timeInZone(iso, timezone));
  const live = reservations.filter(
    (r) =>
      r.status !== 'cancelled' &&
      r.status !== 'no_show' &&
      !(
        r.status === 'pending_payment' &&
        r.paymentHoldExpiresAt &&
        Date.parse(r.paymentHoldExpiresAt) <= Date.now()
      ),
  );
  const from = open[0].value;
  const to = Math.max(
    open.at(-1)!.end ?? open.at(-1)!.value + 15,
    ...live.map((r) => minutesFrom(r.endsAt)),
  );
  const count = Math.ceil((to - from) / 15);
  const columns = Array.from({ length: count }, (_, i) => from + i * 15);
  const openTimes = new Set(open.map((c) => c.value));
  const cells = (table: VenueTable) =>
    columns.map((value) => {
      const at = instantAt(date, value, timezone).getTime();
      const occupied = live.some(
        (r) =>
          ['pending_payment', 'confirmed', 'seated'].includes(r.status) &&
          r.tables.some((t) => t.id === table.id) &&
          new Date(r.startsAt).getTime() < at + 900000 &&
          new Date(r.endsAt).getTime() > at,
      );
      const disabled =
        !onEmpty ||
        !openTimes.has(value) ||
        occupied ||
        date < dateInZone(timezone) ||
        at < Date.now() - 1800000;
      return (
        <button
          key={value}
          type="button"
          disabled={disabled}
          aria-label={`Book ${table.label} at ${clock(value)}`}
          className={cn(
            'h-14 w-16 shrink-0 border-r border-border/60 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
            !openTimes.has(value)
              ? 'bg-muted/70'
              : disabled
                ? 'bg-muted/20'
                : 'hover:bg-primary/10',
          )}
          onClick={() =>
            onEmpty?.({
              date,
              time: clock(value),
              tableId: table.id,
              areaId: table.areaId,
              partySize: Math.min(table.maxSeats, Math.max(2, table.minSeats)),
            })
          }
        />
      );
    });
  return (
    <div
      ref={scroll}
      className="max-h-[70vh] overflow-auto rounded-lg border"
      aria-label="Reservation calendar"
    >
      <div style={{ minWidth: 160 + count * 64 }}>
        <div className="sticky top-0 z-20 flex border-b bg-card text-xs">
          <div className="sticky left-0 w-40 shrink-0 bg-card px-3 py-3 font-semibold">Table</div>
          {columns.map((value) => (
            <div
              key={value}
              className="w-16 shrink-0 border-r px-1 py-3 text-center text-muted-foreground"
            >
              {clock(value)}
              {value >= 1440 ? ' +1' : ''}
            </div>
          ))}
        </div>
        {layout
          .data!.areas.filter((a) => a.active)
          .map((area) => (
            <section key={area.id} aria-label={area.name}>
              <h4 className="sticky left-0 border-b bg-secondary px-3 py-2 text-sm font-semibold">
                {area.name}
              </h4>
              {area.tables
                .filter((t) => t.active)
                .map((table) => (
                  <div key={table.id} className="flex border-b">
                    <div className="sticky left-0 z-10 w-40 shrink-0 bg-card px-3 py-4 text-sm font-medium">
                      {table.label}
                    </div>
                    <div className="relative flex h-14" style={{ width: count * 64 }}>
                      {cells(table)}
                      {live
                        .filter((r) => r.tables.some((t) => t.id === table.id))
                        .map((r) => {
                          const start = Math.max(from, minutesFrom(r.startsAt)),
                            end = minutesFrom(r.endsAt);
                          if (end <= start) return null;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              aria-label={`${r.guestName}, ${timeInZone(r.startsAt, timezone)}-${timeInZone(r.endsAt, timezone)}`}
                              title={`${r.guestName}, ${r.partySize} guests, ${timeInZone(r.startsAt, timezone)}-${timeInZone(r.endsAt, timezone)}`}
                              onClick={() => onBooking?.(r)}
                              className="absolute top-1 h-12 overflow-hidden rounded border border-info bg-info-surface px-2 text-left text-xs text-info outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              style={{
                                left: ((start - from) / 15) * 64,
                                width: ((end - start) / 15) * 64,
                              }}
                            >
                              <span className="block truncate font-semibold">
                                {r.guestName} - {r.partySize}
                              </span>
                              <span className="block truncate">
                                {timeInZone(r.startsAt, timezone)}-{timeInZone(r.endsAt, timezone)}{' '}
                                - {STATUS_DISPLAY[r.status].label}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
            </section>
          ))}
      </div>
    </div>
  );
}
