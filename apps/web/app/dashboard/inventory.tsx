'use client';
import { ClockRoomsTile } from './clock-room-counts';
import { ClockAvailabilityPanel } from './clock-availability-panel';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page-header';
import { TabBar } from '../../components/ui/tab-bar';
import { StatTile } from '../../components/ui/stat-tile';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { Combobox } from '../../components/ui/combobox';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { RowList } from '../../components/ui/row-list';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { RecordDirectory, type RecordColumn } from '../../components/ui/record-directory';
import { AvailabilityGrid } from '../../components/ui/availability-grid';
import { inventoryRequest, createInventoryWriter } from './inventory-api';
import {
  recordName,
  inventoryScope,
  restrictionLabels,
  blockReasonLabels,
  type InventoryRecord,
  type InventoryList,
  type InventoryOverview,
  type CatalogItem,
  type StaffChoice,
} from './inventory-types';
import type { InventoryPrefill } from './inventory-selection';
import { InventoryStock } from './inventory-stock';
import { InventoryEditor } from './inventory-editor';
import { InventoryPreview } from './inventory-preview';
import { InventorySheet, type InventoryAction } from './inventory-sheet';
const activeStates = ['Active', 'Scheduled'];
export function inventoryActions(
  r: InventoryRecord,
  kind: 'restrictions' | 'blocks',
): InventoryAction[] {
  if (kind === 'restrictions')
    return [
      ...(!['Archived', 'Expired'].includes(r.lifecycle)
        ? [
            ...(!activeStates.includes(r.lifecycle)
              ? [{ label: 'Activate', action: 'activate' }]
              : [{ label: 'Pause', action: 'pause' }]),
            { label: 'Archive', action: 'archive' },
          ]
        : []),
      { label: 'Duplicate as draft', action: 'duplicate' },
      ...(r.lifecycle === 'Draft' ? [{ label: 'Delete draft', action: 'delete' }] : []),
    ];
  return [
    ...(r.lifecycle === 'Draft'
      ? [
          { label: 'Activate', action: 'activate' },
          { label: 'Delete draft', action: 'delete' },
        ]
      : []),
    ...(r.lifecycle === 'Active' ? [{ label: 'End block', action: 'end' }] : []),
    ...(['Draft', 'Scheduled'].includes(r.lifecycle)
      ? [{ label: 'Cancel block', action: 'cancel' }]
      : []),
  ];
}
/** Inventory workspace with local operations and explicit provider read-only boundaries. */
export function InventorySection({
  tenantId,
  propertyId,
  emailVerified,
  bookingMode = 'ROOM_TYPE_ONLY',
  currentUser,
}: {
  tenantId: string;
  propertyId: string;
  emailVerified: boolean;
  bookingMode?: string;
  currentUser?: { id: string; email: string };
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/inventory`,
    root = base.slice(0, -10),
    client = useQueryClient();
  const [tab, setTab] = useState('overview'),
    [view, setView] = useState('All'),
    [typeFilter, setTypeFilter] = useState('all'),
    [scopeFilter, setScopeFilter] = useState('all'),
    [healthFilter, setHealthFilter] = useState('all'),
    [priorityFilter, setPriorityFilter] = useState('all'),
    [dateFrom, setDateFrom] = useState(''),
    [dateTo, setDateTo] = useState(''),
    [peek, setPeek] = useState<{ kind: 'restrictions' | 'blocks'; record: InventoryRecord } | null>(
      null,
    ),
    [editor, setEditor] = useState<{
      kind: 'restrictions' | 'blocks';
      record?: InventoryRecord;
      initial?: InventoryPrefill;
    } | null>(null),
    [confirmation, setConfirmation] = useState<{
      kind: 'restrictions' | 'blocks';
      record: InventoryRecord;
      action: string;
    } | null>(null);
  const writer = useRef(createInventoryWriter());
  const permissions = useQuery({
    queryKey: ['dashboard', 'inventory-permissions', tenantId, propertyId],
    queryFn: () => inventoryRequest<string[]>(`${root}/capabilities/mine`),
  });
  const canView = Array.isArray(permissions.data) && permissions.data.includes('calendar.view');
  const data = useQuery({
    queryKey: ['dashboard', 'inventory', tenantId, propertyId],
    enabled: canView,
    queryFn: async () => {
      const [restrictions, blocks, overview, catalog, categories, rooms] = await Promise.all([
        inventoryRequest<InventoryList>(`${base}/restrictions`),
        inventoryRequest<InventoryList>(`${base}/blocks`),
        inventoryRequest<InventoryOverview>(`${base}/overview`),
        inventoryRequest<CatalogItem[]>(`${root}/room-types`),
        inventoryRequest<CatalogItem[]>(`${root}/room-categories`),
        inventoryRequest<CatalogItem[]>(`${root}/rooms`),
      ]);
      return { restrictions, blocks, overview, catalog, categories, rooms };
    },
  });
  const staff = useQuery({
    queryKey: ['dashboard', 'inventory-staff', tenantId, propertyId],
    enabled: canView && permissions.data?.includes('staff.view') === true,
    queryFn: () => inventoryRequest<StaffChoice[]>(`${root}/staff`),
  });
  const conflicts = useQuery({
    queryKey: ['dashboard', 'inventory-conflicts', tenantId, propertyId],
    enabled: canView && tab === 'conflicts' && data.data?.restrictions.source === 'CLOCK_PMS',
    queryFn: () => inventoryRequest<{ reason: string }>(`${base}/conflicts`),
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['dashboard', 'inventory', tenantId, propertyId] }),
      client.invalidateQueries({ queryKey: ['dashboard', 'inventory-stock', base] }),
    ]);
  };
  if (permissions.isPending) return <ListSkeleton />;
  if (permissions.error)
    return (
      <ErrorPanel
        title="Inventory access could not be checked"
        description={permissions.error.message}
        onRetry={() => void permissions.refetch()}
      />
    );
  if (!canView)
    return (
      <EmptyPanel
        title="Inventory access restricted"
        description="Your owner or administrator can grant calendar viewing access."
      />
    );
  if (data.isPending)
    return (
      <>
        <PageHeader title="Inventory" />
        <ListSkeleton />
      </>
    );
  if (data.error || !data.data)
    return (
      <ErrorPanel
        title="Inventory could not be loaded"
        description={data.error?.message}
        onRetry={() => void data.refetch()}
      />
    );
  const { restrictions, blocks, overview, catalog, categories, rooms } = data.data;
  const external = restrictions.source !== 'LOCAL',
    canWrite = !external && emailVerified && permissions.data?.includes('calendar.block') === true,
    kind = tab === 'blocks' ? 'blocks' : 'restrictions',
    list = kind === 'blocks' ? blocks : restrictions;
  const editable = (r: InventoryRecord, k: 'restrictions' | 'blocks') =>
    canWrite &&
    !(k === 'restrictions' ? ['Archived', 'Expired'] : ['Ended', 'Cancelled']).includes(
      r.lifecycle,
    );
  const actionsFor = (r: InventoryRecord, k: 'restrictions' | 'blocks') =>
    canWrite ? inventoryActions(r, k) : [];
  const scope = (r: InventoryRecord) => inventoryScope(r, catalog, categories, rooms);
  const people = [
    ...new Map(
      [
        ...(staff.data ?? []),
        ...(currentUser
          ? [{ userId: currentUser.id, email: currentUser.email, firstName: null, lastName: null }]
          : []),
      ].map((person) => [person.userId, person] as const),
    ).values(),
  ];
  const actorNames = Object.fromEntries(
    people.map((person) => [
      person.userId,
      [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email,
    ]),
  );
  const actorName = (id: string | null | undefined) =>
    id ? (actorNames[id] ?? 'Name unavailable') : undefined;
  const columns: RecordColumn<InventoryRecord>[] = [
    {
      id: 'name',
      label: kind === 'restrictions' ? 'Rule' : 'Block',
      value: (r) => `${recordName(r)} ${r.inventoryReference ?? r.reference ?? ''}`,
      render: (r) => (
        <span className="flex flex-col items-start">
          <span>{recordName(r)}</span>
          <span className="text-xs text-muted-foreground group-data-[density=compact]:hidden">
            {r.inventoryReference ?? r.reference ?? 'Legacy'}
          </span>
        </span>
      ),
    },
    {
      id: 'effect',
      label: kind === 'restrictions' ? 'Type / effect' : 'Reason',
      value: (r) =>
        kind === 'restrictions'
          ? `${restrictionLabels[r.type ?? ''] ?? r.type}: ${['closed_to_arrival', 'closed_to_departure', 'stop_sell'].includes(r.type ?? '') ? (r.value === 1 ? 'Closed' : 'Open exception') : `${r.value} ${r.type === 'minimum_advance' ? 'days' : 'nights'}`}`
          : (blockReasonLabels[r.reason ?? ''] ?? 'Not recorded'),
    },
    { id: 'scope', label: 'Scope', value: scope },
    { id: 'startsOn', label: 'From', value: (r) => r.startsOn },
    {
      id: 'endsOn',
      label: kind === 'restrictions' ? 'Through' : 'Available again',
      value: (r) => r.endsOn ?? 'No end date',
    },
    ...(kind === 'restrictions'
      ? [{ id: 'priority', label: 'Priority', value: (r: InventoryRecord) => r.priority ?? 0 }]
      : []),
    {
      id: 'status',
      label: 'Status',
      value: (r) => r.lifecycle,
      render: (r) => (
        <Badge variant={r.lifecycle === 'Active' ? 'success' : 'secondary'}>{r.lifecycle}</Badge>
      ),
    },
    { id: 'validation', label: 'Validation', value: (r) => r.validation ?? 'Healthy' },
    ...(kind === 'blocks'
      ? [
          {
            id: 'creator',
            label: 'Created by',
            value: (r: InventoryRecord) =>
              r.createdByEmail ?? actorName(r.createdByUserId) ?? 'Not recorded',
          },
          {
            id: 'schedule',
            label: 'Schedule',
            value: (r: InventoryRecord) =>
              r.endingSoon
                ? 'Ending soon'
                : r.lifecycle === 'Scheduled'
                  ? 'Upcoming'
                  : r.lifecycle === 'Active'
                    ? 'In effect'
                    : r.lifecycle,
          },
        ]
      : []),
    {
      id: 'updated',
      label: 'Updated by',
      value: (r) =>
        actorName(r.updatedByUserId) ??
        r.createdByEmail ??
        actorName(r.createdByUserId) ??
        'Not recorded',
    },
  ];
  const statuses = [
    'All',
    ...(kind === 'restrictions'
      ? ['Active', 'Scheduled', 'Draft', 'Paused', 'Expired', 'Archived']
      : ['Active', 'Scheduled', 'Draft', 'Ended', 'Cancelled']),
    'Conflicts',
    'Ending soon',
    'In effect today',
  ];
  const matches = (r: InventoryRecord, label: string) =>
    label === 'All' ||
    (label === 'Conflicts'
      ? r.validation === 'Conflict'
      : label === 'Ending soon'
        ? activeStates.includes(r.lifecycle) &&
          Boolean(
            r.endsOn &&
            r.endsOn >= list.today &&
            r.endsOn <= new Date(Date.parse(list.today) + 7 * 86400000).toISOString().slice(0, 10),
          )
        : label === 'In effect today'
          ? r.lifecycle === 'Active' &&
            (!r.weekdays || r.weekdays.includes(new Date(list.today).getUTCDay() || 7))
          : r.lifecycle === label);
  const filtered = list.items.filter(
    (r) =>
      matches(r, view) &&
      (typeFilter === 'all' || (kind === 'restrictions' ? r.type : r.reason) === typeFilter) &&
      (scopeFilter === 'all' || (r.scope ?? (r.all ? 'property' : 'targets')) === scopeFilter) &&
      (healthFilter === 'all' || r.validation === healthFilter) &&
      (priorityFilter === 'all' || r.priority === Number(priorityFilter)) &&
      (!dateFrom ||
        !r.endsOn ||
        (kind === 'blocks' ? r.endsOn > dateFrom : r.endsOn >= dateFrom)) &&
      (!dateTo || r.startsOn <= dateTo),
  );
  const opened = peek
    ? (data.data[peek.kind].items.find((r) => r.id === peek.record.id) ?? peek.record)
    : null;
  function chooseTab(next: string) {
    setTab(next);
    setView('All');
    setTypeFilter('all');
    setScopeFilter('all');
    setHealthFilter('all');
    setPriorityFilter('all');
    setDateFrom('');
    setDateTo('');
    setPeek(null);
  }
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Inventory"
        description={`Availability, restrictions and manual blocks - ${restrictions.timezone}`}
        actions={
          <>
            <Badge variant="secondary">
              {external ? 'Clock PMS - Read-only' : 'MUST - Local inventory'}
            </Badge>
            <Button variant="outline" onClick={() => void refresh()}>
              Refresh
            </Button>
            {canWrite && ['restrictions', 'blocks'].includes(tab) ? (
              <Button onClick={() => setEditor({ kind })}>
                Create {kind === 'restrictions' ? 'restriction' : 'manual block'}
              </Button>
            ) : null}
          </>
        }
      />
      <TabBar
        label="Inventory sections"
        current={tab}
        onSelect={chooseTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'stock', label: 'Stock' },
          {
            id: 'restrictions',
            label: 'Restrictions',
            ...(!external ? { count: restrictions.items.length } : {}),
          },
          {
            id: 'blocks',
            label: 'Manual Blocks',
            ...(!external ? { count: blocks.items.length } : {}),
          },
          ...(external ? [{ id: 'conflicts', label: 'Conflict Review' }] : []),
        ]}
      />
      {external ? (
        <Alert>
          <AlertTitle>Clock is the source of availability</AlertTitle>
          <AlertDescription>
            Local changes are disabled. Load Clock availability below to see supported room counts
            and day restrictions. Complete block history and inventory health remain managed in
            Clock.
          </AlertDescription>
        </Alert>
      ) : !canWrite ? (
        <Alert>
          <AlertTitle>Viewing access only</AlertTitle>
          <AlertDescription>
            {!emailVerified
              ? 'Verify your email before changing inventory.'
              : 'Your owner or administrator can grant calendar blocking access.'}
          </AlertDescription>
        </Alert>
      ) : null}
      {tab === 'stock' ? (
        external ? (
          <ClockAvailabilityPanel tenantId={tenantId} propertyId={propertyId} />
        ) : (
          <InventoryStock
            base={base}
            canWrite={canWrite}
            onCreate={(kind, initial) => setEditor({ kind, initial })}
          />
        )
      ) : null}
      {tab === 'overview' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {external ? (
              <ClockRoomsTile tenantId={tenantId} propertyId={propertyId} canOpenCalendar />
            ) : (
              <StatTile
                label="Available room nights"
                value={
                  overview.sellablePercentage === null
                    ? 'Unknown'
                    : `${overview.sellablePercentage}%`
                }
                note={
                  overview.totalNights === null
                    ? 'Provider data unavailable'
                    : `${overview.sellableNights} of ${overview.totalNights} - next 30 days`
                }
              />
            )}
            <StatTile
              label="Active restrictions"
              value={external ? 'See day snapshot' : (overview.activeRestrictions ?? 'Unknown')}
            />
            <StatTile
              label="Active manual blocks"
              value={external ? 'Managed in Clock' : (overview.activeBlocks ?? 'Unknown')}
            />
            <StatTile
              label="Needs attention"
              value={external ? 'Review in Clock' : overview.needsAttention.length}
              tone="warning"
            />
          </div>
          {overview.coverage?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Upcoming availability</CardTitle>
                <CardDescription>
                  Free room nights, not a guarantee a full stay is bookable. Use preview for
                  stay-specific rules.{' '}
                  {bookingMode === 'ROOM_TYPE_ONLY'
                    ? 'Individual rooms are not assigned in room-type mode.'
                    : 'Expand a room type to see active rooms. A free room still needs room-type stock and a valid stay.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {catalog.some((type) => type.status === 'DRAFT') ? (
                  <Alert>
                    <AlertTitle>Only published room types are shown</AlertTitle>
                    <AlertDescription>
                      Draft room types hidden:{' '}
                      {catalog
                        .filter((type) => type.status === 'DRAFT')
                        .map((type) => type.name)
                        .join(', ')}
                      . Review them in Accommodations before publishing.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <AvailabilityGrid
                  rows={overview.coverage.map((t) => ({
                    id: t.roomTypeId,
                    label: t.name,
                    children: t.rooms?.map((room) => ({
                      id: room.id,
                      label: room.name,
                      unit: true,
                      days: room.days.map((day) => ({
                        date: day.date,
                        capacity: 1,
                        available: day.available === null ? null : day.available ? 1 : 0,
                        note:
                          day.restrictionErrors.map((error) => error.message).join(' ') ||
                          undefined,
                      })),
                    })),
                    days: t.days.map((d) => ({
                      ...d,
                      note: d.restrictionErrors.map((e) => e.message).join(' ') || undefined,
                    })),
                  }))}
                />
              </CardContent>
            </Card>
          ) : external ? (
            <ClockAvailabilityPanel tenantId={tenantId} propertyId={propertyId} />
          ) : (
            <EmptyPanel
              title="No published inventory"
              description="Publish a room type and configure its rooms or stock to see coverage."
            />
          )}
          {!external ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Active restrictions by type</CardTitle>
                </CardHeader>
                <CardContent>
                  <RowList
                    items={Object.entries(restrictionLabels).map(([key, label]) => ({
                      key,
                      label,
                      value: overview.countsByType[key] ?? 0,
                    }))}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Needs attention</CardTitle>
                </CardHeader>
                <CardContent>
                  {overview.needsAttention.length ? (
                    <RowList
                      items={overview.needsAttention.map((n, i) => ({
                        key: `${n.id}-${i}`,
                        label: (
                          <Button
                            variant="link"
                            className="h-auto p-0 text-left"
                            onClick={() => {
                              const k = n.kind === 'block' ? 'blocks' : 'restrictions';
                              const r = data.data?.[k].items.find((r) => r.id === n.id);
                              if (r) {
                                chooseTab(k);
                                setPeek({ kind: k, record: r });
                              }
                            }}
                          >
                            {n.name}
                          </Button>
                        ),
                        value: n.reason,
                      }))}
                    />
                  ) : (
                    <EmptyPanel title="No current attention items" />
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
          <InventoryPreview
            key={propertyId}
            base={base}
            catalog={catalog}
            rooms={rooms}
            today={restrictions.today}
            bookingMode={bookingMode}
          />
        </>
      ) : null}
      {['restrictions', 'blocks'].includes(tab) ? (
        <>
          {kind === 'restrictions' && !external && restrictions.baseRestrictions?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Base restrictions</CardTitle>
                <CardDescription>Property settings - read-only here - priority 0</CardDescription>
              </CardHeader>
              <CardContent>
                <RowList
                  items={restrictions.baseRestrictions.map((r) => ({
                    key: r.id,
                    label: restrictionLabels[r.type] ?? 'Maximum advance',
                    value: r.value,
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}
          {external ? (
            <ClockAvailabilityPanel tenantId={tenantId} propertyId={propertyId} />
          ) : (
            <>
              <TabBar
                label="Lifecycle views"
                current={view}
                onSelect={setView}
                tabs={statuses.map((label) => ({
                  id: label,
                  label,
                  count: list.items.filter((r) => matches(r, label)).length,
                }))}
              />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Combobox
                  label="Filter by type or reason"
                  value={typeFilter}
                  options={[
                    { value: 'all', label: 'All types / reasons' },
                    ...Object.entries(
                      kind === 'restrictions' ? restrictionLabels : blockReasonLabels,
                    ).map(([value, label]) => ({ value, label })),
                  ]}
                  onChange={setTypeFilter}
                />
                <Combobox
                  label="Filter by scope"
                  value={scopeFilter}
                  options={[
                    { value: 'all', label: 'All scopes' },
                    ...Object.entries(
                      kind === 'restrictions'
                        ? {
                            property: 'Entire property',
                            category: 'Categories',
                            room_type: 'Room types',
                          }
                        : { property: 'Entire property', targets: 'Selected targets' },
                    ).map(([value, label]) => ({ value, label })),
                  ]}
                  onChange={setScopeFilter}
                />
                <Combobox
                  label="Filter by validation"
                  value={healthFilter}
                  options={['all', 'Healthy', 'Conflict', 'Missing targets'].map((value) => ({
                    value,
                    label: value === 'all' ? 'All validation states' : value,
                  }))}
                  onChange={setHealthFilter}
                />
                {kind === 'restrictions' ? (
                  <Combobox
                    label="Filter by priority"
                    value={priorityFilter}
                    options={[
                      { value: 'all', label: 'All priorities' },
                      ...[25, 50, 75, 100].map((n) => ({ value: String(n), label: String(n) })),
                    ]}
                    onChange={setPriorityFilter}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <FormField label="Period from" htmlFor="inventory-filter-from">
                  <Input
                    id="inventory-filter-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </FormField>
                <FormField label="Period through" htmlFor="inventory-filter-through">
                  <Input
                    id="inventory-filter-through"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </FormField>
                <Button variant="ghost" onClick={() => chooseTab(tab)}>
                  Clear filters
                </Button>
              </div>
              <RecordDirectory
                key={kind}
                storageKey={`must.inventory.${kind}.table`}
                rows={filtered}
                columns={columns}
                onRow={(record) => setPeek({ kind, record })}
                actions={(r) => [
                  { label: 'View details', onSelect: () => setPeek({ kind, record: r }) },
                  ...(editable(r, kind)
                    ? [{ label: 'Edit', onSelect: () => setEditor({ kind, record: r }) }]
                    : []),
                  ...actionsFor(r, kind).map((a) => ({
                    label: a.label,
                    onSelect: () => setConfirmation({ kind, record: r, action: a.action }),
                  })),
                ]}
                emptyTitle={
                  list.items.length
                    ? 'No records match these filters'
                    : `No ${kind === 'restrictions' ? 'restrictions' : 'manual blocks'} yet`
                }
              />
            </>
          )}
        </>
      ) : null}
      {tab === 'conflicts' && external ? (
        conflicts.isPending ? (
          <ListSkeleton />
        ) : conflicts.error ? (
          <ErrorPanel
            description={conflicts.error.message}
            onRetry={() => void conflicts.refetch()}
          />
        ) : (
          <EmptyPanel
            title="Provider conflict review Unknown"
            description={conflicts.data?.reason}
          />
        )
      ) : null}
      {peek && opened ? (
        <InventorySheet
          key={`${peek.kind}-${opened.id}`}
          kind={peek.kind}
          record={opened}
          base={base}
          catalog={catalog}
          categories={categories}
          rooms={rooms}
          actorNames={actorNames}
          actions={actionsFor(opened, peek.kind)}
          onAction={(action) => setConfirmation({ kind: peek.kind, record: opened, action })}
          onEdit={
            editable(opened, peek.kind)
              ? () => {
                  setPeek(null);
                  setEditor({ kind: peek.kind, record: opened });
                }
              : undefined
          }
          onClose={() => setPeek(null)}
        />
      ) : null}
      {editor && canWrite ? (
        <InventoryEditor
          key={`${editor.kind}-${editor.record?.id ?? 'new'}`}
          {...editor}
          base={base}
          today={restrictions.today}
          timezone={restrictions.timezone}
          catalog={catalog}
          categories={categories}
          rooms={rooms}
          bookingMode={bookingMode}
          staff={staff.data ? people : null}
          onClose={() => setEditor(null)}
          onSaved={(record) => {
            setEditor(null);
            setPeek({ kind: editor.kind, record });
            void refresh();
          }}
        />
      ) : null}
      {confirmation && canWrite ? (
        <ConfirmDialog
          open
          title={`${confirmation.action === 'delete' ? 'Delete draft' : confirmation.action[0].toUpperCase() + confirmation.action.slice(1)} ${recordName(confirmation.record)}?`}
          description="Checked against the latest version. Existing reservations remain unchanged."
          confirmLabel="Confirm change"
          destructive={['delete', 'end', 'cancel', 'archive'].includes(confirmation.action)}
          reasonLabel={confirmation.action === 'end' ? 'Reason for reopening' : undefined}
          reasonRequired={confirmation.action === 'end'}
          onOpenChange={(open) => {
            if (!open) setConfirmation(null);
          }}
          onConfirm={async (endReason) => {
            const result = await writer.current<InventoryRecord | { deleted: true }>(
              `${base}/${confirmation.kind}/${confirmation.record.id}${confirmation.action === 'delete' ? '' : '/' + confirmation.action}`,
              confirmation.action === 'delete' ? 'DELETE' : 'POST',
              { version: confirmation.record.version, ...(endReason ? { endReason } : {}) },
            );
            setPeek('deleted' in result ? null : { kind: confirmation.kind, record: result });
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}
