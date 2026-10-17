'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
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
import { BulkBar, ColumnChooser, DensityToggle } from '../../components/ui/table-toolbar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useTablePreferences } from '../../lib/use-table-preferences';
import { cn } from '../../lib/utils';
import { formatMoneyList, guestStatsById, guestsCsv, type GuestStats } from './guest-stats';
import { GuestBadges, GuestSheet, stayLabel } from './guest-sheet';
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

type SortKey = 'guest' | 'stays' | 'lastStay' | 'nextStay' | 'value' | 'owed';
type GuestView = 'all' | 'returning' | 'first-time' | 'balance' | 'duplicates';

type ColumnKey = 'contact' | 'type' | 'lastStay' | 'nextStay' | 'value' | 'owed';
const COLUMN_LABELS: Record<ColumnKey, string> = {
  contact: 'Contact',
  type: 'Guest type',
  lastStay: 'Last stay',
  nextStay: 'Next stay',
  value: 'Net paid',
  owed: 'Still owed',
};
const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = {
  contact: true,
  type: true,
  lastStay: true,
  nextStay: true,
  value: true,
  owed: true,
};
const todayIso = () => new Date().toISOString().slice(0, 10);

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
  canMergeGuests = true,
}: {
  tenantId: string;
  propertyId: string;
  canMergeGuests?: boolean;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Guest>();
  const [ticked, setTicked] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const { columns, density, toggleColumn, toggleDensity } = useTablePreferences('must.guests.table', DEFAULT_COLUMNS);
  const [canonicalByGuest, setCanonicalByGuest] = useState<Record<string, string>>({});
  const [mergeCandidate, setMergeCandidate] = useState<MergeCandidate | null>(null);
  const [view, setView] = useState<GuestView>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
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
    setTicked([]);
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
  const stats = useMemo(() => guestStatsById(bookings, todayIso()), [bookings]);
  const emptyStats = (guest: Guest): GuestStats | undefined => stats.get(guest.id);
  const counts = useMemo(
    () => ({
      all: guests.length,
      returning: guests.filter((guest) => stats.get(guest.id)?.kind === 'returning').length,
      'first-time': guests.filter((guest) => stats.get(guest.id)?.kind !== 'returning').length,
      balance: guests.filter((guest) => stats.get(guest.id)?.hasBalance).length,
      duplicates: duplicateCount,
    }),
    [duplicateCount, guests, stats],
  );
  const viewGuests = useMemo(
    () =>
      guests.filter((guest) => {
        const entry = stats.get(guest.id);
        if (view === 'returning') return entry?.kind === 'returning';
        if (view === 'first-time') return entry?.kind !== 'returning';
        if (view === 'balance') return entry?.hasBalance === true;
        return true;
      }),
    [guests, stats, view],
  );
  const sortedGuests = useMemo(() => {
    const value = (guest: Guest): string | number => {
      const entry = stats.get(guest.id);
      if (sort.key === 'guest') return guestName(guest).toLocaleLowerCase();
      if (sort.key === 'stays') return entry?.stays ?? guest.bookingCount;
      if (sort.key === 'value') return entry?.netValue ?? 0;
      if (sort.key === 'owed') return entry?.outstandingValue ?? 0;
      if (sort.key === 'nextStay') return entry?.next?.startsOn ?? '9999-12-31';
      return entry?.last?.startsOn ?? '';
    };
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...viewGuests].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      return (left < right ? -1 : left > right ? 1 : 0) * factor;
    });
  }, [sort, stats, viewGuests]);
  const pageGuests = sortedGuests.slice((page - 1) * pageSize, page * pageSize);
  const history = selected
    ? bookings
        .filter((booking) => booking.guestId === selected.id)
        .sort((a, b) => b.startsOn.localeCompare(a.startsOn))
    : [];
  const tickedGuests = guests.filter((guest) => ticked.includes(guest.id));
  const allTicked = pageGuests.length > 0 && pageGuests.every((guest) => ticked.includes(guest.id));
  const someTicked = pageGuests.some((guest) => ticked.includes(guest.id));
  const tick = (id: string, checked: boolean) =>
    setTicked((current) => (checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)));
  const tickAll = (checked: boolean) =>
    setTicked((current) => {
      const pageIds = pageGuests.map((guest) => guest.id);
      return checked ? [...new Set([...current, ...pageIds])] : current.filter((id) => !pageIds.includes(id));
    });
  const copyEmails = async () => {
    try {
      await navigator.clipboard.writeText(tickedGuests.map((guest) => guest.email).join('\n'));
      setNotice(`Copied ${tickedGuests.length} email${tickedGuests.length === 1 ? '' : 's'}.`);
    } catch {
      setNotice('Could not copy. Select the emails manually.');
    }
  };
  const exportCsv = (list: Guest[]) => {
    const blob = new Blob([String.fromCharCode(0xfeff), guestsCsv(list, stats)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `guests-${todayIso()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
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
        : { key, direction: key === 'guest' || key === 'nextStay' ? 'asc' : 'desc' },
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
      <PageHeader
        title="Guests"
        description="Everyone who has booked this hotel, with their stays and what they owe."
        actions={
          <Button variant="outline" disabled={sortedGuests.length === 0} onClick={() => exportCsv(sortedGuests)}>
            <Download /> Export CSV
          </Button>
        }
      />

      <Card className="gap-0 overflow-clip p-0">
        <div className="space-y-3 border-b p-4">
          <TabBar
            tabs={[
              { id: 'all', label: 'All guests', count: counts.all },
              { id: 'returning', label: 'Returning', count: counts.returning },
              { id: 'first-time', label: 'First-time', count: counts['first-time'] },
              { id: 'balance', label: 'With balance', count: counts.balance },
              { id: 'duplicates', label: 'Suspected duplicates', count: counts.duplicates },
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
            <ColumnChooser labels={COLUMN_LABELS} visible={columns} onToggle={toggleColumn} />
            <DensityToggle compact={density === 'compact'} onToggle={toggleDensity} />
          </div>
          <FilterChips
            chips={search.trim() ? [{ key: 'search', label: `Search: ${search.trim()}` }] : []}
            onRemove={() => setSearchValue('')}
            onClearAll={() => setSearchValue('')}
          />
          <BulkBar count={tickedGuests.length} onClear={() => setTicked([])}>
            <Button variant="outline" size="sm" onClick={() => void copyEmails()}>
              Copy emails
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportCsv(tickedGuests)}>
              Export selected
            </Button>
          </BulkBar>
          {notice ? (
            <p role="status" className="m-0 text-xs text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </div>

        {view === 'duplicates' ? (
          <section aria-labelledby="suspected-duplicates-heading" className="space-y-4 p-4">
            <div className="space-y-1">
              <h3 id="suspected-duplicates-heading" className="m-0 text-base font-semibold">
                Suspected duplicates
              </h3>
              <p className="m-0 text-sm text-muted-foreground">
                Review profiles that matched on one contact signal. Merging moves the other profile&apos;s
                bookings to the profile you keep.
              </p>
            </div>
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
                {canMergeGuests ? (
                  <>
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
                  </>
                ) : null}
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
          </section>
        ) : guests.length === 0 ? (
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
            <Table
              containerClassName="overflow-x-clip"
              data-density={density}
              className="group text-[11px] data-[density=compact]:[&_td]:py-1"
            >
              <TableHeader className="sticky top-[var(--app-header-height,86px)] z-20 bg-muted">
                <TableRow className="hover:bg-muted">
                  <TableHead className="w-8 px-3 py-2">
                    <Checkbox
                      aria-label="Select all guests on this page"
                      checked={allTicked ? true : someTicked ? 'indeterminate' : false}
                      onCheckedChange={(value) => tickAll(value === true)}
                    />
                  </TableHead>
                  <SortableTableHead label="Guest" active={sort.key === 'guest'} direction={sort.direction} onSort={() => toggleSort('guest')} />
                  {columns.contact ? <TableHead className="px-2 py-2 normal-case tracking-normal">Contact</TableHead> : null}
                  {columns.type ? <TableHead className="px-2 py-2 normal-case tracking-normal">Guest type</TableHead> : null}
                  <SortableTableHead label="Stays" active={sort.key === 'stays'} direction={sort.direction} onSort={() => toggleSort('stays')} align="right" />
                  {columns.lastStay ? (
                    <SortableTableHead label="Last stay" active={sort.key === 'lastStay'} direction={sort.direction} onSort={() => toggleSort('lastStay')} />
                  ) : null}
                  {columns.nextStay ? (
                    <SortableTableHead label="Next stay" active={sort.key === 'nextStay'} direction={sort.direction} onSort={() => toggleSort('nextStay')} />
                  ) : null}
                  {columns.value ? (
                    <SortableTableHead label="Net paid" active={sort.key === 'value'} direction={sort.direction} onSort={() => toggleSort('value')} align="right" />
                  ) : null}
                  {columns.owed ? (
                    <SortableTableHead label="Still owed" active={sort.key === 'owed'} direction={sort.direction} onSort={() => toggleSort('owed')} align="right" />
                  ) : null}
                  <TableHead className="w-10 px-2 py-2 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageGuests.map((guest) => {
                  const name = guestName(guest);
                  const detailHref = guestHref(tenantId, propertyId, guest.id);
                  const entry = emptyStats(guest);
                  const isTicked = ticked.includes(guest.id);
                  return (
                    <TableRow
                      key={guest.id}
                      data-state={isTicked ? 'selected' : undefined}
                      className={cn(
                        'h-14 cursor-pointer group-data-[density=compact]:h-10',
                        isTicked && 'bg-primary/10 hover:bg-primary/10',
                      )}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('button, a, input, label, [role="checkbox"], [role="menuitem"]')) return;
                        setSelected(guest);
                      }}
                    >
                      <TableCell className="px-3 py-2">
                        <Checkbox
                          aria-label={`Select ${name}`}
                          checked={isTicked}
                          onCheckedChange={(value) => tick(guest.id, value === true)}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar>
                            <AvatarFallback>{guestInitials(guest)}</AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setSelected(guest)}
                              aria-label={`Show details for ${name}`}
                              className="block max-w-full truncate bg-transparent p-0 text-left text-[12px] font-semibold text-foreground hover:underline"
                            >
                              {name}
                            </button>
                            <span className="block truncate text-[10px] text-muted-foreground group-data-[density=compact]:hidden">
                              {guest.email}
                            </span>
                          </span>
                        </div>
                      </TableCell>
                      {columns.contact ? (
                        <TableCell className="max-w-56 px-2 py-2">
                          <span className="block truncate">{guest.phone ?? <span className="text-muted-foreground">No phone on file</span>}</span>
                        </TableCell>
                      ) : null}
                      {columns.type ? (
                        <TableCell className="px-2 py-2">
                          <span className="flex flex-wrap gap-1">
                            <GuestBadges stats={entry} duplicate={duplicateGuestIds.has(guest.id)} />
                          </span>
                        </TableCell>
                      ) : null}
                      <TableCell className="px-2 py-2 text-right font-semibold tabular-nums">
                        {entry?.stays ?? guest.bookingCount}
                        {entry && entry.cancelled > 0 ? (
                          <span className="block text-[10px] font-normal text-muted-foreground group-data-[density=compact]:hidden">
                            {entry.cancelled} cancelled
                          </span>
                        ) : null}
                      </TableCell>
                      {columns.lastStay ? (
                        <TableCell className="px-2 py-2 whitespace-nowrap">
                          {stayLabel(entry?.last) ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      ) : null}
                      {columns.nextStay ? (
                        <TableCell className="px-2 py-2 whitespace-nowrap">
                          {entry?.current ? (
                            <span className="font-semibold text-info">Staying now</span>
                          ) : (
                            (stayLabel(entry?.next) ?? <span className="text-muted-foreground">—</span>)
                          )}
                        </TableCell>
                      ) : null}
                      {columns.value ? (
                        <TableCell className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                          {entry ? formatMoneyList(entry.net) : '—'}
                        </TableCell>
                      ) : null}
                      {columns.owed ? (
                        <TableCell
                          className={cn(
                            'px-2 py-2 text-right whitespace-nowrap tabular-nums',
                            entry?.hasBalance ? 'font-semibold text-warning' : 'text-muted-foreground',
                          )}
                        >
                          {entry?.hasBalance ? formatMoneyList(entry.outstanding) : '—'}
                        </TableCell>
                      ) : null}
                      <TableCell className="px-2 py-1 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`} className="size-7">
                              <MoreHorizontal aria-hidden="true" className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{name}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setSelected(guest)}>Quick view</DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={detailHref}>Open profile</a>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`mailto:${guest.email}`}>Send email</a>
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

      <GuestSheet
        guest={selected ?? null}
        stats={selected ? stats.get(selected.id) : undefined}
        bookings={history}
        duplicate={selected ? duplicateGuestIds.has(selected.id) : false}
        tenantId={tenantId}
        propertyId={propertyId}
        onClose={() => setSelected(undefined)}
      />

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
