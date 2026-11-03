'use client';

import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Timeline, type TimelineItem } from '../../components/ui/timeline';

type StayEvent = {
  from: string;
  to: string;
  at: string;
  by: string | null;
  earlyDeparture: boolean;
  balanceOverridden: boolean;
  note: string | null;
};

const dateTime = (value: string) =>
  new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** What one recorded step means in plain words. */
export function stayEventTitle(event: Pick<StayEvent, 'from' | 'to'>): string {
  if (event.to === 'checked_in')
    return event.from === 'checked_out' ? 'Check-out undone' : 'Checked in';
  if (event.to === 'checked_out') return 'Checked out';
  if (event.to === 'no_show') return 'Marked as a no-show';
  if (event.from === 'checked_in') return 'Check-in undone';
  if (event.from === 'no_show') return 'No-show undone';
  return 'Back to expected';
}

/** The real arrival and departure of a stay, and every step staff took, newest first. Hidden until there is one. */
export function StayHistory({
  tenantId,
  propertyId,
  bookingId,
  stayStatus,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  /** The stay's current status; a change reloads the history. */
  stayStatus: string | null;
}) {
  const query = useQuery({
    queryKey: ['dashboard', 'stay-events', tenantId, propertyId, bookingId, stayStatus],
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}/stay-events`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('The stay history could not be loaded.');
      return ((await response.json()) as { events: StayEvent[] }).events;
    },
  });
  const events = query.data ?? [];
  if (events.length === 0) return null;
  const items: TimelineItem[] = [...events].reverse().map((event, index) => ({
    key: `${event.at}-${index}`,
    title: stayEventTitle(event),
    meta: `${dateTime(event.at)}${event.by ? ` · ${event.by}` : ''}`,
    detail:
      event.earlyDeparture || event.balanceOverridden || event.note ? (
        <>
          {event.earlyDeparture ? <p>Left before the booked departure day.</p> : null}
          {event.balanceOverridden ? <p>Checked out with a balance open.</p> : null}
          {event.note ? <p>{event.note}</p> : null}
        </>
      ) : undefined,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Arrival and departure</CardTitle>
      </CardHeader>
      <CardContent>
        <Timeline items={items} />
      </CardContent>
    </Card>
  );
}
