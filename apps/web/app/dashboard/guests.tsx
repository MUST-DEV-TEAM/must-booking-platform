'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { FilterChips } from '../../components/ui/filter-chips';
import { OptionCard } from '../../components/ui/option-card';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { SortableTableHead } from '../../components/ui/sortable-table-head';
import { EmptyPanel, ErrorPanel, ListSkeleton, NoResultsPanel } from '../../components/ui/state-panel';
import { TabBar } from '../../components/ui/tab-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { guestHref } from './payment-detail';
import { fetchPropertyBookings } from './reservations';

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

type SortKey = 'guest' | 'bookings' | 'lastStay';
type GuestView = 'all' | 'duplicates';

type MergeCandidate = {
  pair: SuspectedDuplicatePair;
  canonicalProfile: GuestReviewProfile;
  otherProfile: GuestReviewProfile;
};

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function formatDay(value: string | undefined, withYear: boolean) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

function guestName(guest: Pick<Guest, 'firstName' | 'lastName' | 'email'>) {
  return [guest.firstName, guest.lastName].filter(Boolean).join(' ') || guest.email;
}

function guestInitials(guest: Pick<Guest, 'firstName' | 'lastName' | 'email'>) {
  const initials = [guest.firstName, guest.lastName]
    .filter(Boolean)
    .map((part) => part![0])
    .join('');
  return initials ? initials.slice(0, 2).toLocaleUpperCase() : guest.email.slice(0, 1).toLocaleUpperCase();
}

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
  const [mergeCandidate, setMergeCandidate] = useState<MergeCandidate | null>(null);
  const [view, setView] = useState<GuestView>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'lastStay',
    direction: 'desc',
  });
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
    setMergeCandidate(null);
    setView('all');
    setPage(1);
  }, [tenantId, propertyId]);

  const guests = guestsQuery.data ?? [];
  const bookings = bookingsQuery.data ?? [];
  const duplicatePairs = duplicateQuery.data ?? [];
  const duplicateGuestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pair of duplicatePairs) {
      ids.add(pair.guest.id);
      ids.add(pair.suspectedDuplicate.id);
    }
    return ids;
  }, [duplicatePairs]);
  const duplicateCount = guests.filter((guest) => duplicateGuestIds.has(guest.id)).length;
  const viewGuests = useMemo(
    () =>
      guests.filter((guest) => view === 'all' || duplicateGuestIds.has(guest.id)),
    [duplicateGuestIds, guests, view],
  );
  const sortedGuests = useMemo(() => {
    const value = (guest: Guest): string | number => {
      if (sort.key === 'guest') return guestName(guest).toLocaleLowerCase();
      if (sort.key === 'bookings') return guest.bookingCount;
      return guest.mostRecentStartsOn ?? '';
    };
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...viewGuests].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      return (left < right ? -1 : left > right ? 1 : 0) * factor;
    });
  }, [sort, viewGuests]);
  const pageGuests = sortedGuests.slice((page - 1) * pageSize, page * pageSize);
  const history = selected
    ? bookings.filter((booking) => booking.guestId === selected.id || booking.guestEmail === selected.email)
    : [];

  const setSearchValue = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const selectView = (next: string) => {
    setView(next as GuestView);
    setPage(1);
  };
  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'guest' ? 'asc' : 'desc' },
    );
    setPage(1);
  };
  const clearFilters = () => {
    setSearchValue('');
    selectView('all');
  };

  if (guestsQuery.isPending || bookingsQuery.isPending || duplicateQuery.isPending)
    return (
      <div className="space-y-5">
        <PageHeader title="Guests" description="Guest directory and property booking history." />
        <ListSkeleton rows={6} />
      </div>
    );

  const error = guestsQuery.error ?? bookingsQuery.error ?? duplicateQuery.error;
  if (error)
    return (
      <div className="space-y-5">
        <PageHeader title="Guests" description="Guest directory and property booking history." />
        <ErrorPanel
          title="Guests could not be loaded"
          description={error.message}
          onRetry={() => {
            void guestsQuery.refetch();
            void bookingsQuery.refetch();
            void duplicateQuery.refetch();
          }}
        />
      </div>
    );

  return (
    <div className="space-y-5">
      <PageHeader title="Guests" description="Guest directory and property booking history." />

      <Card className="gap-0 overflow-clip p-0">
        <div className="space-y-3 border-b p-4">
          <TabBar
            tabs={[
              { id: 'all', label: 'All guests', count: guests.length },
              { id: 'duplicates', label: 'Suspected duplicates', count: duplicateCount },
            ]}
            current={view}
            onSelect={selectView}
            label="Guest views"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SearchInput
              aria-label="Search guests"
              className="w-full sm:w-80"
              value={search}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Name, email, or phone"
            />
          </div>
          <FilterChips
            chips={search.trim() ? [{ key: 'search', label: `Search: ${search.trim()}` }] : []}
            onRemove={() => setSearchValue('')}
            onClearAll={() => setSearchValue('')}
          />
        </div>

        {guests.length === 0 ? (
          debouncedSearch ? (
            <NoResultsPanel onClear={clearFilters} />
          ) : (
            <div className="p-4">
              <EmptyPanel
                title="No guest profiles yet"
                description="Guest profiles appear after a reservation is created."
              />
            </div>
          )
        ) : sortedGuests.length === 0 ? (
          <div className="p-4">
            <NoResultsPanel onClear={clearFilters} />
          </div>
        ) : (
          <>
            <Table containerClassName="overflow-x-clip" className="text-xs">
              <TableHeader className="sticky top-[var(--app-header-height,86px)] z-20 bg-muted">
                <TableRow className="hover:bg-muted">
                  <SortableTableHead
                    label="Guest"
                    active={sort.key === 'guest'}
                    direction={sort.direction}
                    onSort={() => toggleSort('guest')}
                  />
                  <TableHead className="px-2 py-2 normal-case tracking-normal">Contact</TableHead>
                  <SortableTableHead
                    label="Bookings"
                    active={sort.key === 'bookings'}
                    direction={sort.direction}
                    onSort={() => toggleSort('bookings')}
                    align="right"
                  />
                  <SortableTableHead
                    label="Last stay"
                    active={sort.key === 'lastStay'}
                    direction={sort.direction}
                    onSort={() => toggleSort('lastStay')}
                  />
                  <TableHead className="w-10 px-2 py-2 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageGuests.map((guest) => {
                  const name = guestName(guest);
                  const detailHref = guestHref(tenantId, propertyId, guest.id);
                  return (
                    <TableRow key={guest.id} className="h-14">
                      <TableCell className="px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar>
                            <AvatarFallback>{guestInitials(guest)}</AvatarFallback>
                          </Avatar>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto min-w-0 !px-0 py-0 text-left text-foreground"
                            onClick={() => setSelected(guest)}
                            aria-label={`Show booking history for ${name}`}
                          >
                            <span className="truncate">{name}</span>
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-64 px-2 py-2">
                        <span className="block truncate">{guest.email}</span>
                        {guest.phone ? (
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {guest.phone}
                          </span>
                        ) : (
                          <span className="block text-[10px] text-muted-foreground">No phone on file</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right font-semibold tabular-nums">
                        {guest.bookingCount}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {guest.mostRecentStartsOn ? (
                          <span className="whitespace-nowrap">
                            {formatDay(guest.mostRecentStartsOn, false)}
                            {guest.mostRecentEndsOn
                              ? ` – ${formatDay(guest.mostRecentEndsOn, true)}`
                              : ''}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`More actions for ${name}`}
                              className="size-7"
                            >
                              <MoreHorizontal aria-hidden="true" className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{name}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <a href={detailHref}>Open profile</a>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setSelected(guest)}>
                              View booking history
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={sortedGuests.length}
              onPage={setPage}
              noun="guests"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </Card>

      {selected ? (
        <Card className="gap-4">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">
                  {guestName(selected)} — booking history
                </CardTitle>
                <p className="m-0 text-sm text-muted-foreground">
                  {history.length} booking{history.length === 1 ? '' : 's'} found for this guest.
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={guestHref(tenantId, propertyId, selected.id)}>Open guest profile</a>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {history.length ? (
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Stay</TableHead>
                    <TableHead>Room type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell>
                        {booking.startsOn} – {booking.endsOn}
                      </TableCell>
                      <TableCell>{booking.roomTypeName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">No bookings found.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="suspected-duplicates-heading">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle id="suspected-duplicates-heading" className="text-base">
              Suspected duplicates
            </CardTitle>
            <p className="m-0 text-sm text-muted-foreground">
              Review profiles that matched on one contact signal. Merging moves the other profile&apos;s
              bookings to the profile you keep.
            </p>
          </CardHeader>
          <CardContent>
            {duplicatePairs.length ? (
              <div className="flex flex-col gap-4">
                {duplicatePairs.map((pair) => {
                  const selectedCanonical = canonicalByGuest[pair.guest.id];
                  const pending =
                    reviewMutation.isPending && reviewMutation.variables?.guestId === pair.guest.id;
                  const differing = differingFields(pair.guest, pair.suspectedDuplicate);
                  const canonicalProfile =
                    selectedCanonical === pair.guest.id
                      ? pair.guest
                      : selectedCanonical === pair.suspectedDuplicate.id
                        ? pair.suspectedDuplicate
                        : null;
                  const otherProfile =
                    canonicalProfile === pair.guest
                      ? pair.suspectedDuplicate
                      : canonicalProfile === pair.suspectedDuplicate
                        ? pair.guest
                        : null;
                  return (
                    <Card className="gap-4 bg-muted/20 p-4" key={pair.guest.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge variant="warning">{matchReason(pair.guest, pair.suspectedDuplicate)}</Badge>
                        <span className="text-xs text-muted-foreground">
                          Select which profile to keep
                        </span>
                      </div>
                      <div
                        className="grid gap-3 md:grid-cols-2"
                        role="radiogroup"
                        aria-label={`Choose the profile to keep for ${guestName(pair.guest)}`}
                      >
                        {[pair.guest, pair.suspectedDuplicate].map((profile) => {
                          const selectedProfile = selectedCanonical === profile.id;
                          return (
                            <OptionCard
                              key={profile.id}
                              title={guestName(profile)}
                              badges={selectedProfile ? <Badge variant="success">Selected to keep</Badge> : null}
                              selected={selectedProfile}
                              disabled={pending}
                              description={
                                <div className="flex flex-col gap-1">
                                  <span className="break-all">
                                    Email: {profile.email}
                                    {differing.has('email') ? ' · different' : ''}
                                  </span>
                                  <span>
                                    Phone: {profile.phone || '—'}
                                    {differing.has('phone') ? ' · different' : ''}
                                  </span>
                                  <span>
                                    Name: {guestName(profile)}
                                    {differing.has('name') ? ' · different' : ''}
                                  </span>
                                  <span>
                                    {profile.bookingCount} booking{profile.bookingCount === 1 ? '' : 's'}
                                  </span>
                                </div>
                              }
                              onSelect={() =>
                                setCanonicalByGuest((current) => ({
                                  ...current,
                                  [pair.guest.id]: profile.id,
                                }))
                              }
                            />
                          );
                        })}
                      </div>
                      {canonicalProfile && otherProfile ? (
                        <p className="m-0 text-sm text-muted-foreground">
                          Keeping <strong className="text-foreground">{guestName(canonicalProfile)}</strong>{' '}
                          — the {otherProfile.bookingCount} booking
                          {otherProfile.bookingCount === 1 ? '' : 's'} on the other profile move here.{' '}
                          {mergePreviewNote(canonicalProfile, otherProfile)}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={!selectedCanonical || pending}
                          loading={pending}
                          onClick={() => {
                            if (!selectedCanonical || !canonicalProfile || !otherProfile) return;
                            setMergeCandidate({ pair, canonicalProfile, otherProfile });
                          }}
                        >
                          Merge profiles
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            reviewMutation.mutate({ kind: 'dismiss', guestId: pair.guest.id })
                          }
                        >
                          Not a duplicate
                        </Button>
                        {reviewMutation.error && reviewMutation.variables?.guestId === pair.guest.id ? (
                          <span role="alert" className="text-sm text-destructive">
                            {reviewMutation.error.message}
                          </span>
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <EmptyPanel
                title="No suspected duplicates"
                description="Profiles matched on one contact signal will appear here for staff review."
              />
            )}
          </CardContent>
        </Card>
      </section>

      <ConfirmDialog
        open={mergeCandidate !== null}
        onOpenChange={(open) => {
          if (!open) setMergeCandidate(null);
        }}
        title="Merge guest profiles?"
        description={
          mergeCandidate ? (
            <>
              Keep <strong>{guestName(mergeCandidate.canonicalProfile)}</strong>. The other profile&apos;s{' '}
              {mergeCandidate.otherProfile.bookingCount} booking
              {mergeCandidate.otherProfile.bookingCount === 1 ? '' : 's'} will move to this profile.
              {' '}
              This action cannot be undone from this screen. {mergePreviewNote(
                mergeCandidate.canonicalProfile,
                mergeCandidate.otherProfile,
              )}
            </>
          ) : null
        }
        confirmLabel="Merge profiles"
        destructive
        onConfirm={async () => {
          if (!mergeCandidate) return;
          await reviewMutation.mutateAsync({
            kind: 'merge',
            guestId: mergeCandidate.pair.guest.id,
            canonicalGuestId: mergeCandidate.canonicalProfile.id,
          });
        }}
      />
    </div>
  );
}

function differingFields(
  a: GuestReviewProfile,
  b: GuestReviewProfile,
): Set<'email' | 'phone' | 'name'> {
  const differing = new Set<'email' | 'phone' | 'name'>();
  if (a.email.trim().toLowerCase() !== b.email.trim().toLowerCase()) differing.add('email');
  if ((a.phone?.trim() || null) !== (b.phone?.trim() || null)) differing.add('phone');
  if (guestName(a) !== guestName(b)) differing.add('name');
  return differing;
}

/** Explains which contact signal caused a possible duplicate to be raised. */
function matchReason(a: GuestReviewProfile, b: GuestReviewProfile): string {
  const emailMatches = a.email.trim().toLowerCase() === b.email.trim().toLowerCase();
  const phoneMatches = a.phone && b.phone && a.phone.trim() === b.phone.trim() ? true : false;
  if (phoneMatches && !emailMatches)
    return 'Flagged because the phone number matches, but the email addresses differ.';
  if (emailMatches && !phoneMatches)
    return 'Flagged because the email matches, but the phone numbers differ.';
  return 'Flagged as a possible duplicate.';
}

/** Mirrors the merge rule: fields on the chosen profile win; only blank values are filled. */
function mergePreviewNote(canonical: GuestReviewProfile, other: GuestReviewProfile): string {
  const fills: string[] = [];
  if (!canonical.phone?.trim() && other.phone?.trim()) fills.push(`phone ${other.phone}`);
  if (
    !canonical.firstName?.trim() &&
    !canonical.lastName?.trim() &&
    guestName(other) !== other.email
  )
    fills.push(`name ${guestName(other)}`);
  return fills.length ? `It will also pick up the other profile's ${fills.join(' and ')}.` : '';
}

function useDebouncedValue(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}
