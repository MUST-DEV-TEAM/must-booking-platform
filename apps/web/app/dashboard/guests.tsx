'use client';
import { Card, Heading, Stack, StatePanel, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchPropertyBookings } from './reservations';
import styles from './data-table.module.css';
import reviewStyles from './guests.module.css';
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
type GuestReviewProfile = Pick<Guest, 'id' | 'email' | 'firstName' | 'lastName' | 'phone'> & {
  bookingCount: number;
};
type SuspectedDuplicatePair = {
  guest: GuestReviewProfile;
  suspectedDuplicate: GuestReviewProfile;
};
type ReviewAction =
  | { kind: 'merge'; guestId: string; canonicalGuestId: string }
  | { kind: 'dismiss'; guestId: string };
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
  const [canonicalByGuest, setCanonicalByGuest] = useState<Record<string, string>>({});
  const debouncedSearch = useDebouncedValue(search, 300);
  const queryClient = useQueryClient();

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
  const duplicateQuery = useQuery({
    queryKey: ['dashboard', 'suspected-duplicates', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}/guests/suspected-duplicates`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to load suspected duplicates.');
      return (await response.json()) as SuspectedDuplicatePair[];
    },
  });
  const reviewMutation = useMutation({
    mutationFn: async (action: ReviewAction) => {
      const path =
        action.kind === 'merge'
          ? `${base}/guests/${action.guestId}/merge`
          : `${base}/guests/${action.guestId}/dismiss-duplicate`;
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:
          action.kind === 'merge'
            ? JSON.stringify({ canonicalGuestId: action.canonicalGuestId })
            : undefined,
      });
      if (!response.ok)
        throw new Error(
          action.kind === 'merge'
            ? 'Unable to merge guests.'
            : 'Unable to dismiss the duplicate flag.',
        );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['dashboard', 'suspected-duplicates', tenantId, propertyId],
        }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'guests', tenantId, propertyId] }),
      ]);
    },
  });

  useEffect(() => {
    setSelected(undefined);
    setCanonicalByGuest({});
  }, [tenantId, propertyId]);
  const guests = guestsQuery.data ?? [];
  const bookings = bookingsQuery.data ?? [];
  const duplicatePairs = duplicateQuery.data ?? [];
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
  if (guestsQuery.isPending || bookingsQuery.isPending || duplicateQuery.isPending)
    return (
      <StatePanel
        body={null}
        icon={<LoaderCircle aria-hidden="true" />}
        title="Loading guests…"
        variant="loading"
      />
    );
  const error = guestsQuery.error ?? bookingsQuery.error ?? duplicateQuery.error;
  if (error)
    return (
      <div role="alert">
        <Text>{error.message}</Text>
        <button
          className="must-button must-button--secondary"
          onClick={() => {
            void guestsQuery.refetch();
            void bookingsQuery.refetch();
            void duplicateQuery.refetch();
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
      <section aria-labelledby="suspected-duplicates-heading">
        <Heading id="suspected-duplicates-heading" level={2}>
          Suspected duplicates
        </Heading>
        <Text tone="secondary">
          Review profiles that matched on only one contact signal. Merging moves the losing
          profile&apos;s bookings to the profile you keep.
        </Text>
        {duplicatePairs.length ? (
          <div className={reviewStyles.queue}>
            {duplicatePairs.map((pair) => {
              const selectedCanonical = canonicalByGuest[pair.guest.id];
              const pending =
                reviewMutation.isPending && reviewMutation.variables?.guestId === pair.guest.id;
              return (
                <Card className={reviewStyles.pair} key={pair.guest.id}>
                  <div className={reviewStyles.profiles}>
                    <ReviewProfile
                      profile={pair.guest}
                      checked={selectedCanonical === pair.guest.id}
                      name={pair.guest.id}
                      onSelect={() =>
                        setCanonicalByGuest((current) => ({
                          ...current,
                          [pair.guest.id]: pair.guest.id,
                        }))
                      }
                    />
                    <ReviewProfile
                      profile={pair.suspectedDuplicate}
                      checked={selectedCanonical === pair.suspectedDuplicate.id}
                      name={pair.guest.id}
                      onSelect={() =>
                        setCanonicalByGuest((current) => ({
                          ...current,
                          [pair.guest.id]: pair.suspectedDuplicate.id,
                        }))
                      }
                    />
                  </div>
                  <div className={reviewStyles.actions}>
                    <button
                      className="must-button must-button--primary"
                      disabled={!selectedCanonical || pending}
                      onClick={() => {
                        if (!selectedCanonical) return;
                        reviewMutation.mutate({
                          kind: 'merge',
                          guestId: pair.guest.id,
                          canonicalGuestId: selectedCanonical,
                        });
                      }}
                      type="button"
                    >
                      {pending ? 'Merging…' : 'Merge'}
                    </button>
                    <button
                      className="must-button must-button--secondary"
                      disabled={pending}
                      onClick={() =>
                        reviewMutation.mutate({ kind: 'dismiss', guestId: pair.guest.id })
                      }
                      type="button"
                    >
                      Not a duplicate
                    </button>
                    {reviewMutation.error && reviewMutation.variables?.guestId === pair.guest.id ? (
                      <Text tone="secondary">{reviewMutation.error.message}</Text>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Text tone="secondary">No suspected duplicates need review.</Text>
        )}
      </section>
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

function ReviewProfile({
  profile,
  checked,
  name,
  onSelect,
}: {
  profile: GuestReviewProfile;
  checked: boolean;
  name: string;
  onSelect: () => void;
}) {
  return (
    <label className={reviewStyles.profile}>
      <span className={reviewStyles.profileChoice}>
        <input checked={checked} name={`canonical-${name}`} onChange={onSelect} type="radio" />
        Keep this profile
      </span>
      <strong>{guestName(profile)}</strong>
      <dl>
        <div>
          <dt>Email</dt>
          <dd>{profile.email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{profile.phone || '—'}</dd>
        </div>
        <div>
          <dt>Bookings</dt>
          <dd>{profile.bookingCount}</dd>
        </div>
      </dl>
    </label>
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
