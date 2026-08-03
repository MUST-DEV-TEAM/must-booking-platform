'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useEffect, useState } from 'react';
import { fetchPropertyBookings, type Reservation } from './reservations';
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
  const [guests, setGuests] = useState<Guest[]>();
  const [bookings, setBookings] = useState<Reservation[]>();
  const [selected, setSelected] = useState<Guest>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void fetch(`${base}/guests${search ? `?search=${encodeURIComponent(search)}` : ''}`, {
          credentials: 'include',
        })
          .then(async (r) => {
            if (!r.ok) throw new Error('Unable to load guests.');
            return r.json();
          })
          .then(setGuests)
          .catch(() => setError('Unable to load guests.')),
      300,
    );
    return () => clearTimeout(timer);
  }, [base, search]);
  useEffect(() => {
    void fetchPropertyBookings(tenantId, propertyId)
      .then(setBookings)
      .catch(() => setError('Unable to load guest booking history.'));
  }, [tenantId, propertyId]);
  if (error) return <Text>{error}</Text>;
  if (!guests || !bookings) return <DashboardLoadingSkeleton label="Loading guests…" />;
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
