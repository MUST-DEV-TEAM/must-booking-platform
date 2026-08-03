'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fetchPropertyBookings } from './reservations';
import { DashboardLoadingSkeleton } from './loading-skeleton';
type Guest = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  bookingCount: number;
  mostRecentStartsOn: string;
  mostRecentEndsOn: string;
};
export function DashboardGuests({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Guest>();
  const debouncedSearch = useDebouncedValue(search, 300);

  const guestsQuery = useQuery({
    queryKey: ['dashboard', 'guests', tenantId, propertyId, debouncedSearch],
    queryFn: async () => {
      const response = await fetch(
        `${base}/guests${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Unable to load guests.');
      return (await response.json()) as Guest[];
    },
  });
  const bookingsQuery = useQuery({
    queryKey: ['dashboard', 'guest-bookings', tenantId, propertyId],
    queryFn: async () => {
      try {
        return await fetchPropertyBookings(tenantId, propertyId);
      } catch {
        throw new Error('Unable to load guest booking history.');
      }
    },
  });

  useEffect(() => {
    setSelected(undefined);
  }, [tenantId, propertyId]);
  if (guestsQuery.isPending || bookingsQuery.isPending)
    return <DashboardLoadingSkeleton label="Loading guests…" />;
  const error = guestsQuery.error ?? bookingsQuery.error;
  if (error)
    return (
      <div role="alert">
        <Text>{error.message}</Text>
        <button
          onClick={() => {
            void guestsQuery.refetch();
            void bookingsQuery.refetch();
          }}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  const guests = guestsQuery.data ?? [];
  const bookings = bookingsQuery.data ?? [];
  const history = selected
    ? bookings.filter((b) => b.guestId === selected.id || b.guestEmail === selected.email)
    : [];
  return (
    <Stack gap="lg">
      <header>
        <Heading>Guests</Heading>
        <Text tone="secondary">Guest directory and property booking history.</Text>
      </header>
      <input
        aria-label="Search guests"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Name, email, or phone"
      />
      <Card>
        <ul>
          {guests.map((g) => (
            <li key={g.id}>
              <button onClick={() => setSelected(g)}>
                {[g.firstName, g.lastName].filter(Boolean).join(' ') || g.email}
              </button>
              <Text tone="secondary">
                {g.email} · {g.bookingCount} bookings · latest {g.mostRecentStartsOn}
              </Text>
            </li>
          ))}
        </ul>
      </Card>
      {selected ? (
        <Card>
          <Heading level={2}>
            {[selected.firstName, selected.lastName].filter(Boolean).join(' ') || selected.email} —
            booking history
          </Heading>
          {history.length ? (
            <ul>
              {history.map((b) => (
                <li key={b.id}>
                  {b.startsOn} – {b.endsOn} · {b.roomTypeName}
                </li>
              ))}
            </ul>
          ) : (
            <Text tone="secondary">No bookings found.</Text>
          )}
        </Card>
      ) : null}
    </Stack>
  );
}

function useDebouncedValue(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}
