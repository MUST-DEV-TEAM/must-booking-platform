'use client';
import { useState, type ReactNode } from 'react';
import { ListFilter, Plus, RefreshCw } from 'lucide-react';
import {
  areaHealth,
  bookingReadinessAreas,
  type Property,
} from '../../app/dashboard/settings-areas';
import { settingsAreaHref } from '../../app/dashboard/settings-hub';
import { useTablePreferences } from '../../lib/use-table-preferences';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent } from './card';
import { Checkbox } from './checkbox';
import { ChecklistPanel } from './checklist-panel';
import { DetailList } from './detail-list';
import { FilterGrid } from './filter-grid';
import { FormField } from './form-field';
import { HotelBrand } from './hotel-brand';
import { PageHero } from './page-hero';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { QuickPeek } from './quick-peek';
import { SearchInput } from './search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { SortableTableHead } from './sortable-table-head';
import { EmptyPanel, ErrorPanel, ListSkeleton, NoResultsPanel } from './state-panel';
import { TabBar } from './tab-bar';
import { BulkBar, ColumnChooser, DensityToggle } from './table-toolbar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export type DirectoryHotel = Property & {
  staffCount: number;
  pmsSource: 'MUST' | 'CLOCK_PMS';
  connectedProviders: string[];
};
const modeLabels = {
  ROOM_TYPE_ONLY: 'Room types',
  INDIVIDUAL_ROOM_ONLY: 'Individual rooms',
  MIXED: 'Rooms & room types',
};
const columnLabels = {
  address: 'City / address',
  mode: 'Booking mode',
  connection: 'Connection',
  website: 'Website',
  payments: 'Payment readiness',
  staff: 'Staff',
  status: 'Status',
};
type Column = keyof typeof columnLabels;
const defaults: Record<Column, boolean> = {
  address: true,
  mode: true,
  connection: true,
  website: true,
  payments: true,
  staff: true,
  status: true,
};
export function hotelReadiness(hotel: DirectoryHotel) {
  const health = areaHealth(hotel, null, new Set(hotel.connectedProviders));
  return {
    health,
    active: bookingReadinessAreas.every(({ key }) => health[key].status === 'done'),
  };
}
function paymentLabel(h: DirectoryHotel) {
  return h.paymentGateways.pokpay && h.connectedProviders.includes('POKPAY')
    ? 'PokPay connected'
    : h.paymentGateways.stripe && h.connectedProviders.includes('STRIPE')
      ? 'Stripe connected'
      : h.paymentGateways.payAtHotel
        ? 'Pay at hotel only'
        : 'Needs setup';
}
function connectionLabel(h: DirectoryHotel) {
  return h.pmsSource === 'CLOCK_PMS'
    ? h.connectedProviders.includes('CLOCK_PMS')
      ? 'Clock-connected'
      : 'Clock - needs attention'
    : 'MUST-source';
}
/** Shared hotel directory and hotel detail panel; callers supply only authorized records. */
export function HotelDirectory({
  tenantId,
  hotels,
  loading = false,
  error,
  onRetry,
  canCreate = false,
  canOpenSettings = false,
  onCreate,
  createDialog,
}: {
  tenantId: string;
  hotels: DirectoryHotel[];
  loading?: boolean;
  error?: string;
  onRetry: () => void;
  canCreate?: boolean;
  canOpenSettings?: boolean;
  onCreate: () => void;
  createDialog?: ReactNode;
}) {
  const [tab, setTab] = useState('all'),
    [search, setSearch] = useState(''),
    [connection, setConnection] = useState('all'),
    [mode, setMode] = useState('all'),
    [website, setWebsite] = useState('all'),
    [payment, setPayment] = useState('all');
  const [sort, setSort] = useState<{ key: 'name' | Column; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc',
  });
  const [selected, setSelected] = useState<string[]>([]),
    [peekId, setPeekId] = useState<string | null>(null);
  const { columns, density, toggleColumn, toggleDensity } = useTablePreferences(
    `hotels:${tenantId}`,
    defaults,
  );
  const ready = (h: DirectoryHotel) => hotelReadiness(h).active;
  const value = (h: DirectoryHotel, key: 'name' | Column): string | number =>
    ({
      name: h.name,
      address: h.address,
      mode: modeLabels[h.bookingMode],
      connection: connectionLabel(h),
      website:
        hotelReadiness(h).health['managed-pages'].status === 'done' ? 'Connected' : 'Not connected',
      payments: paymentLabel(h),
      staff: h.staffCount,
      status: ready(h) ? 'Active' : 'Needs setup',
    })[key];
  const rows = hotels
    .filter(
      (h) =>
        (tab === 'all' || ready(h) === (tab === 'active')) &&
        (!search.trim() ||
          [h.name, h.address].join(' ').toLowerCase().includes(search.trim().toLowerCase())) &&
        (connection === 'all' || h.pmsSource === connection) &&
        (mode === 'all' || h.bookingMode === mode) &&
        (website === 'all' ||
          (value(h, 'website') === 'Connected') === (website === 'connected')) &&
        (payment === 'all' || paymentLabel(h) === payment),
    )
    .sort((a, b) => {
      const x = value(a, sort.key),
        y = value(b, sort.key);
      return (
        (typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y))) * (sort.direction === 'asc' ? 1 : -1)
      );
    });
  const selectedVisible = rows.filter((h) => selected.includes(h.id));
  const selectedCount = hotels.filter((h) => selected.includes(h.id)).length;
  const peek = hotels.find((h) => h.id === peekId);
  const clear = () => {
    setTab('all');
    setSearch('');
    setConnection('all');
    setMode('all');
    setWebsite('all');
    setPayment('all');
  };
  const setSortKey = (key: 'name' | Column) =>
    setSort({ key, direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' });
  const filter = (
    label: string,
    v: string,
    set: (v: string) => void,
    options: Record<string, string>,
  ) => (
    <FormField label={label}>
      <Select value={v} onValueChange={set}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {Object.entries(options).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
  return (
    <div className="space-y-4">
      <PageHero
        eyebrow="Organisation"
        title="Hotels"
        description="Your hotels, their connections and the settings they need to take bookings."
        actions={
          <>
            <Button variant="outline" onClick={onRetry} disabled={loading}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
            {canCreate ? (
              <Button onClick={onCreate}>
                <Plus className="size-4" aria-hidden="true" />
                Add hotel
              </Button>
            ) : null}
          </>
        }
        chips={
          !loading && !error ? (
            <>
              <Badge variant="outline">{hotels.length} hotels</Badge>
              <Badge variant="success">{hotels.filter(ready).length} active</Badge>
              <Badge variant="warning">{hotels.filter((h) => !ready(h)).length} need setup</Badge>
            </>
          ) : undefined
        }
      />
      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorPanel title="Hotels unavailable" description={error} onRetry={onRetry} />
      ) : hotels.length === 0 ? (
        <EmptyPanel
          title="No hotels available"
          description={
            canCreate
              ? 'Add your first hotel to start setting up bookings.'
              : 'Hotels assigned to you will appear here.'
          }
          action={canCreate ? <Button onClick={onCreate}>Add hotel</Button> : undefined}
        />
      ) : (
        <Card className="gap-0 py-0">
          <CardContent className="space-y-4 p-4">
            <TabBar
              label="Hotel views"
              current={tab}
              onSelect={setTab}
              tabs={[
                { id: 'all', label: 'All', count: hotels.length },
                { id: 'active', label: 'Active', count: hotels.filter(ready).length },
                {
                  id: 'setup',
                  label: 'Needs setup',
                  count: hotels.filter((h) => !ready(h)).length,
                },
              ]}
            />
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                className="min-w-48 flex-1"
                aria-label="Search hotels"
                placeholder="Search hotel name or address"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    <ListFilter className="size-4" aria-hidden="true" />
                    Filters
                    {[connection, mode, website, payment].filter((v) => v !== 'all').length
                      ? ` (${[connection, mode, website, payment].filter((v) => v !== 'all').length})`
                      : ''}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(36rem,calc(100vw-2rem))]">
                  <FilterGrid>
                    {filter('Connection', connection, setConnection, {
                      MUST: 'MUST-source',
                      CLOCK_PMS: 'Clock',
                    })}
                    {filter('Booking mode', mode, setMode, modeLabels)}
                    {filter('Website status', website, setWebsite, {
                      connected: 'Connected',
                      disconnected: 'Not connected',
                    })}
                    {filter('Payment readiness', payment, setPayment, {
                      'PokPay connected': 'PokPay connected',
                      'Stripe connected': 'Stripe connected',
                      'Pay at hotel only': 'Pay at hotel only',
                      'Needs setup': 'Needs setup',
                    })}
                  </FilterGrid>
                </PopoverContent>
              </Popover>
              <ColumnChooser labels={columnLabels} visible={columns} onToggle={toggleColumn} />
              <DensityToggle compact={density === 'compact'} onToggle={toggleDensity} />
              {search ||
              tab !== 'all' ||
              [connection, mode, website, payment].some((v) => v !== 'all') ? (
                <Button variant="ghost" onClick={clear}>
                  Clear filters
                </Button>
              ) : null}
            </div>
            <BulkBar count={selectedCount} noun="hotels selected" onClear={() => setSelected([])} />
            {rows.length === 0 ? (
              <NoResultsPanel onClear={clear} />
            ) : (
              <Table aria-label="Hotels">
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Checkbox
                        aria-label="Select visible hotels"
                        checked={
                          selectedVisible.length === rows.length
                            ? true
                            : selectedVisible.length
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked
                              ? [...new Set([...selected, ...rows.map((h) => h.id)])]
                              : selected.filter((id) => !rows.some((h) => h.id === id)),
                          )
                        }
                      />
                    </TableHead>
                    <SortableTableHead
                      label="Hotel"
                      active={sort.key === 'name'}
                      direction={sort.direction}
                      onSort={() => setSortKey('name')}
                    />
                    {(Object.keys(columnLabels) as Column[])
                      .filter((k) => columns[k])
                      .map((k) => (
                        <SortableTableHead
                          key={k}
                          label={columnLabels[k]}
                          active={sort.key === k}
                          direction={sort.direction}
                          onSort={() => setSortKey(k)}
                        />
                      ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((h) => (
                    <TableRow
                      key={h.id}
                      data-state={selected.includes(h.id) ? 'selected' : undefined}
                      onClick={() => setPeekId(h.id)}
                      className={
                        density === 'compact' ? 'cursor-pointer [&>td]:py-2' : 'cursor-pointer'
                      }
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${h.name}`}
                          checked={selected.includes(h.id)}
                          onCheckedChange={(checked) =>
                            setSelected(
                              checked ? [...selected, h.id] : selected.filter((id) => id !== h.id),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="max-w-64 border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Preview ${h.name}`}
                          onClick={() => setPeekId(h.id)}
                        >
                          <HotelBrand showNameWithLogo name={h.name} logoUrl={h.logoUrl} />
                        </button>
                        {density !== 'compact' ? (
                          <p className="m-0 mt-1 text-xs text-muted-foreground">{h.timezone}</p>
                        ) : null}
                      </TableCell>
                      {(Object.keys(columnLabels) as Column[])
                        .filter((k) => columns[k])
                        .map((k) => (
                          <TableCell key={k}>
                            {k === 'status' ? (
                              <Badge variant={ready(h) ? 'success' : 'warning'}>
                                {value(h, k)}
                              </Badge>
                            ) : k === 'connection' ? (
                              <>
                                <Badge variant="outline">{value(h, k)}</Badge>
                                {h.pmsSource === 'CLOCK_PMS' && density !== 'compact' ? (
                                  <p className="m-0 mt-1 text-xs text-muted-foreground">
                                    Managed in Clock
                                  </p>
                                ) : null}
                              </>
                            ) : k === 'address' ? (
                              <span className="block max-w-48 truncate" title={h.address}>
                                {h.address || 'Not set'}
                              </span>
                            ) : (
                              value(h, k)
                            )}
                          </TableCell>
                        ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="m-0 text-xs text-muted-foreground">
              {rows.length} of {hotels.length} hotels
            </p>
          </CardContent>
        </Card>
      )}
      <QuickPeek
        open={!!peek}
        onClose={() => setPeekId(null)}
        title={peek?.name ?? 'Hotel details'}
        description={
          peek?.pmsSource === 'CLOCK_PMS'
            ? 'Bookings and accommodation data are managed in Clock.'
            : 'MUST manages bookings and accommodation data.'
        }
        badges={
          peek ? (
            <>
              <Badge variant={ready(peek) ? 'success' : 'warning'}>
                {ready(peek) ? 'Active' : 'Needs setup'}
              </Badge>
              <Badge variant="outline">{connectionLabel(peek)}</Badge>
            </>
          ) : undefined
        }
        actions={
          peek ? (
            <>
              <Button asChild>
                <a
                  href={`/dashboard/${tenantId}?propertyId=${encodeURIComponent(peek.id)}&section=overview`}
                >
                  Open dashboard
                </a>
              </Button>
              {canOpenSettings ? (
                <Button variant="outline" asChild>
                  <a href={settingsAreaHref(tenantId, peek.id)}>Open Settings</a>
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {peek ? (
          <>
            <HotelBrand showNameWithLogo name={peek.name} logoUrl={peek.logoUrl} />
            <DetailList
              stackOnMobile
              items={[
                { label: 'Address', value: peek.address || 'Not set' },
                { label: 'Time zone', value: peek.timezone },
                { label: 'Booking mode', value: modeLabels[peek.bookingMode] },
                { label: 'Website', value: value(peek, 'website') },
                { label: 'Payments', value: paymentLabel(peek) },
                { label: 'Staff with access', value: peek.staffCount },
              ]}
            />
            <ChecklistPanel
              title="Ready to take bookings"
              description="The same required checks as Settings."
              items={bookingReadinessAreas.map(({ key, label }) => ({
                key,
                label,
                detail: hotelReadiness(peek).health[key].note,
                status: hotelReadiness(peek).health[key].status as 'done' | 'attention' | 'todo',
                href: canOpenSettings ? settingsAreaHref(tenantId, peek.id, key) : undefined,
              }))}
            />
          </>
        ) : null}
      </QuickPeek>
      {createDialog}
    </div>
  );
}
