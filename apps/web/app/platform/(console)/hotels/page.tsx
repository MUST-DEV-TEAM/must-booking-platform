'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { FilterChips } from '../../../../components/ui/filter-chips';
import { PageHeader } from '../../../../components/ui/page-header';
import { Pagination } from '../../../../components/ui/pagination';
import { PermissionPanel } from '../../../../components/ui/permission-panel';
import { SearchInput } from '../../../../components/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Skeleton } from '../../../../components/ui/skeleton';
import { SortableTableHead } from '../../../../components/ui/sortable-table-head';
import { EmptyPanel, ErrorPanel, NoResultsPanel } from '../../../../components/ui/state-panel';
import { StatTile } from '../../../../components/ui/stat-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import {
  ConsoleApiError,
  consoleGet,
  type HotelDirectory,
  LIFECYCLE_LABELS,
  type LifecycleState,
  MODE_LABELS,
} from '../../../../lib/platform-api';
import { formatDate } from '../../../../lib/platform-format';
import { LifecycleBadge } from '../../lifecycle-badge';
import { useConsoleSession } from '../console-frame';

type SortKey = 'name' | 'created' | 'lifecycle' | 'owner' | 'bookings';
const STATES = Object.keys(LIFECYCLE_LABELS) as LifecycleState[];

export default function HotelsPage() {
  const { can } = useConsoleSession();
  const [search, setSearch] = useState('');
  const [lifecycle, setLifecycle] = useState<LifecycleState | null>(null);
  const [mode, setMode] = useState<'all' | 'CLOCK' | 'MUST_SOURCE'>('all');
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'created',
    direction: 'desc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const query = useQuery({
    queryKey: ['platform-console', 'hotels', search, lifecycle, mode, sort, page, pageSize],
    enabled: can('platform.hotels.view'),
    queryFn: () => {
      const params = new URLSearchParams({
        sort: sort.key,
        direction: sort.direction,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) params.set('search', search.trim());
      if (lifecycle) params.set('lifecycle', lifecycle);
      if (mode !== 'all') params.set('mode', mode);
      return consoleGet<HotelDirectory>(`/hotels?${params}`);
    },
    placeholderData: (previous) => previous,
  });

  if (!can('platform.hotels.view')) return <PermissionPanel />;

  const toggleSort = (key: SortKey) => {
    setPage(1);
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'name' || key === 'owner' ? 'asc' : 'desc' },
    );
  };
  const head = (label: string, key: SortKey) => (
    <SortableTableHead
      label={label}
      active={sort.key === key}
      direction={sort.direction}
      onSort={() => toggleSort(key)}
    />
  );

  const chips = [
    ...(lifecycle ? [{ key: 'lifecycle', label: `Status: ${LIFECYCLE_LABELS[lifecycle]}` }] : []),
    ...(mode !== 'all' ? [{ key: 'mode', label: `Mode: ${MODE_LABELS[mode]}` }] : []),
    ...(search.trim() ? [{ key: 'search', label: `Search: ${search.trim()}` }] : []),
  ];
  const clear = (key?: string) => {
    setPage(1);
    if (!key || key === 'lifecycle') setLifecycle(null);
    if (!key || key === 'mode') setMode('all');
    if (!key || key === 'search') setSearch('');
  };

  const data = query.data;
  const counts = data?.lifecycleCounts;
  const everything = counts ? STATES.reduce((sum, state) => sum + counts[state], 0) : 0;

  return (
    <>
      <PageHeader
        title="Hotels"
        description="Every hotel MUST Group runs: status, owner, mode and plan in one place."
        actions={
          can('platform.hotels.create') ? (
            <Button asChild>
              <a href="/platform/hotels/new">
                <Plus aria-hidden="true" /> Add hotel
              </a>
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {STATES.map((state) => (
          <StatTile
            key={state}
            label={LIFECYCLE_LABELS[state]}
            value={counts ? counts[state] : '–'}
            active={lifecycle === state}
            tone={
              state === 'SUSPENDED' || state === 'CANCELLED'
                ? 'danger'
                : state === 'PAST_DUE'
                  ? 'warning'
                  : 'default'
            }
            onClick={() => {
              setPage(1);
              setLifecycle((current) => (current === state ? null : state));
            }}
          />
        ))}
      </div>

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <SearchInput
            aria-label="Search hotels or owners"
            placeholder="Search hotel or owner email"
            className="w-full sm:w-72"
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
          <Select
            value={mode}
            onValueChange={(value) => {
              setPage(1);
              setMode(value as typeof mode);
            }}
          >
            <SelectTrigger aria-label="Filter by mode" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modes</SelectItem>
              <SelectItem value="CLOCK">{MODE_LABELS.CLOCK}</SelectItem>
              <SelectItem value="MUST_SOURCE">{MODE_LABELS.MUST_SOURCE}</SelectItem>
            </SelectContent>
          </Select>
          <FilterChips chips={chips} onRemove={clear} onClearAll={() => clear()} />
        </div>

        {query.isError ? (
          <div className="p-4">
            <ErrorPanel
              title="We couldn’t load the hotels"
              reference={
                query.error instanceof ConsoleApiError
                  ? (query.error.reference ?? undefined)
                  : undefined
              }
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : query.isLoading ? (
          <div className="space-y-2 p-4" role="status" aria-label="Loading hotels">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : data && data.total === 0 ? (
          <div className="p-4">
            {chips.length > 0 || everything > 0 ? (
              <NoResultsPanel onClear={() => clear()} />
            ) : (
              <EmptyPanel
                title="No hotels yet"
                description="Add the first hotel to start onboarding."
                action={
                  can('platform.hotels.create') ? (
                    <Button asChild>
                      <a href="/platform/hotels/new">Add hotel</a>
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {head('Hotel', 'name')}
                  {head('Status', 'lifecycle')}
                  <TableHead className="px-2">Mode</TableHead>
                  {head('Owner', 'owner')}
                  <TableHead className="px-2">Plan</TableHead>
                  <TableHead className="px-2">Health</TableHead>
                  {head('Bookings', 'bookings')}
                  {head('Created', 'created')}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((hotel) => (
                  <TableRow key={hotel.id}>
                    <TableCell className="px-2 font-semibold">
                      <a
                        href={`/platform/hotels/${hotel.id}`}
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {hotel.name}
                      </a>
                      {hotel.country ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {hotel.country}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-2">
                      <LifecycleBadge state={hotel.lifecycleState} />
                    </TableCell>
                    <TableCell className="px-2">
                      <Badge variant="outline">{MODE_LABELS[hotel.mode]}</Badge>
                    </TableCell>
                    <TableCell className="px-2">
                      {hotel.ownerEmail ? (
                        <span className="inline-flex max-w-60 items-center gap-2">
                          <span className="truncate" title={hotel.ownerEmail}>
                            {hotel.ownerEmail}
                          </span>
                          {hotel.ownerPending ? <Badge variant="warning">Invited</Badge> : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No owner yet</span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 text-muted-foreground">{hotel.planName}</TableCell>
                    <TableCell className="px-2">
                      <Badge variant="muted">Not scored yet</Badge>
                    </TableCell>
                    <TableCell className="px-2 tabular-nums">{hotel.bookingCount}</TableCell>
                    <TableCell className="px-2 text-muted-foreground">
                      {formatDate(hotel.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={data.total}
              noun="hotels"
              onPage={setPage}
              pageSizeOptions={[10, 25, 50, 100]}
              onPageSize={(size) => {
                setPage(1);
                setPageSize(size);
              }}
            />
          </>
        ) : null}
      </Card>
    </>
  );
}
