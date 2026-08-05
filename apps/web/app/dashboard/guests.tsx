'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { fetchPropertyBookings } from './reservations';
import { DashboardLoadingSkeleton } from './loading-skeleton';
import styles from './data-table.module.css';
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
  const guests = guestsQuery.data ?? [];
  const bookings = bookingsQuery.data ?? [];
  const columns = useMemo<ColumnDef<Guest>[]>(
    () => [
      {
        id: 'guest',
        header: 'Guest',
        cell: ({ row }) => (
          <button onClick={() => setSelected(row.original)}>{guestName(row.original)}</button>
        ),
      },
      {
        id: 'details',
        header: 'Details',
        cell: ({ row }) => (
          <Text tone="secondary">
            {row.original.email} · {row.original.bookingCount} bookings · latest{' '}
            {row.original.mostRecentStartsOn}
          </Text>
        ),
      },
    ],
    [],
  );
  const table = useReactTable({
    data: guests,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (guest) => guest.id,
  });
  if (guestsQuery.isPending || bookingsQuery.isPending)
    return <DashboardLoadingSkeleton label="Loading guests…" />;
  const error = guestsQuery.error ?? bookingsQuery.error;
  if (error)
    return (
      <div role="alert">
        <Text>{error.message}</Text>
        <button
          className="must-button must-button--secondary"
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
        className="must-input"
        aria-label="Search guests"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Name, email, or phone"
      />
      <Card>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

function guestName(guest: Pick<Guest, 'firstName' | 'lastName' | 'email'>) {
  return [guest.firstName, guest.lastName].filter(Boolean).join(' ') || guest.email;
}

function useDebouncedValue(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}
