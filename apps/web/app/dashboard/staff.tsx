'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { FilterChips } from '../../components/ui/filter-chips';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { PasswordField } from '../../components/ui/password-field';
import { Pagination } from '../../components/ui/pagination';
import { MultiSelect } from '../../components/ui/multi-select';
import {
  PermissionList,
  permissionMultiSelectOptions,
  type PermissionCatalogItem,
} from '../../components/ui/permission-list';
import { SearchInput } from '../../components/ui/search-input';
import { SortableTableHead } from '../../components/ui/sortable-table-head';
import {
  EmptyPanel,
  ErrorPanel,
  ListSkeleton,
  NoResultsPanel,
} from '../../components/ui/state-panel';
import { TabBar } from '../../components/ui/tab-bar';
import { BulkBar, ColumnChooser, DensityToggle } from '../../components/ui/table-toolbar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useTablePreferences } from '../../lib/use-table-preferences';
import { cn } from '../../lib/utils';
import { StaffDetail, staffHref, staffListHref } from './staff-detail';
import { StaffSheet } from './staff-sheet';
import { type StaffMember, type StaffTemplate } from './staff-stats';
import { RestaurantStaffProfile } from './restaurant-staff-profile';
import { venueApi, type Venue } from './venues/venue-api';
import { VENUE_ROLE_OPTIONS } from './venues/venue-roles';
import {
  RESTAURANT_PERMISSION_CATALOG,
  RESTAURANT_ROLE_ROWS,
  type RestaurantRoleRow,
} from './venues/restaurant-role-cards';

type Usage = {
  plan: { maxStaffSeats: number; diningEnabled?: boolean };
  usage: { staffSeats: number };
};
type StaffView = 'all' | 'active' | 'suspended' | 'with-extra' | 'without-extra';
type SortKey = 'member' | 'role' | 'extra' | 'status' | 'last-active';
type ColumnKey = 'role' | 'extra' | 'status' | 'lastActive';
type OverrideValue = 'default' | 'grant' | 'revoke';

const COLUMN_LABELS: Record<ColumnKey, string> = {
  role: 'Role',
  extra: 'Extra permissions',
  status: 'Status',
  lastActive: 'Last active',
};
const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = {
  role: true,
  extra: true,
  status: true,
  lastActive: true,
};
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function staffKey(member: StaffMember) {
  return member.restaurant ? `${member.restaurant.venueId}/${member.userId}` : member.userId;
}

function sortValue(member: StaffMember, key: SortKey): string {
  if (key === 'member')
    return `${member.firstName ?? ''} ${member.lastName ?? ''} ${member.email}`.toLocaleLowerCase();
  if (key === 'role') return member.roleTemplateName.toLocaleLowerCase();
  if (key === 'extra')
    return String(member.overrides.filter((item) => item.granted).length).padStart(6, '0');
  if (key === 'status') return member.status;
  return String(member.lastActiveAt ? Date.parse(member.lastActiveAt) || 0 : 0).padStart(16, '0');
}

function formatLastActive(value: string | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
}

/** Staff users for one selected property. */
export function DashboardStaff({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const base = `/api/tenants/${tenantId}`;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [screen, setScreen] = useState<'staff' | 'roles'>('staff');
  const [view, setView] = useState<StaffView>('all');
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'member',
    direction: 'asc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StaffMember | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<StaffMember | null>(null);
  const { columns, density, toggleColumn, toggleDensity } = useTablePreferences(
    'must.staff.table',
    DEFAULT_COLUMNS,
  );

  const staffQuery = useQuery({
    queryKey: ['dashboard', 'staff', tenantId, propertyId],
    queryFn: async () => {
      const propertyFetch = (path: string) =>
        propertyId
          ? fetch(`${base}/properties/${propertyId}/${path}`, { credentials: 'include' })
          : Promise.resolve(new Response(null, { status: 403 }));
      const [staffResponse, templatesResponse, usageResponse, catalogResponse, mineResponse] =
        await Promise.all([
          propertyFetch('staff'),
          propertyFetch('role-templates'),
          fetch(`${base}/plan-usage`, { credentials: 'include' }),
          propertyFetch('capabilities/catalog'),
          propertyFetch('capabilities/mine'),
        ]);
      if (
        (!staffResponse.ok && staffResponse.status !== 403) ||
        (!templatesResponse.ok && templatesResponse.status !== 403) ||
        !usageResponse.ok ||
        (!catalogResponse.ok && catalogResponse.status !== 403) ||
        (!mineResponse.ok && mineResponse.status !== 403)
      )
        throw new Error('Unable to load staff management data.');
      const [staff, templates, usage, catalog, myCapabilities] = (await Promise.all([
        staffResponse.ok ? staffResponse.json() : [],
        templatesResponse.ok ? templatesResponse.json() : [],
        usageResponse.json(),
        catalogResponse.ok ? catalogResponse.json() : [],
        mineResponse.ok ? mineResponse.json() : [],
      ])) as [StaffMember[], StaffTemplate[], Usage, PermissionCatalogItem[], string[]];
      const venues: Venue[] = [];
      const restaurantRows: StaffMember[] = [];
      if (usage.plan.diningEnabled || staffResponse.status === 403) {
        const available = await venueApi.listVenues(tenantId);
        for (const venue of available.filter(
          (v) => v.active && (!v.propertyId || v.propertyId === propertyId),
        )) {
          try {
            const people = await venueApi.listStaff(tenantId, venue.id);
            venues.push(venue);
            restaurantRows.push(
              ...people.map((person) => ({
                ...person,
                roleTemplateId: person.role,
                roleTemplateName: person.role === 'MANAGER' ? 'Restaurant Manager' : 'Waiter',
                status: person.suspendedAt ? ('SUSPENDED' as const) : ('ACTIVE' as const),
                lastActiveAt: null,
                overrides: [],
                restaurant: { venueId: venue.id, venueName: venue.name, role: person.role },
              })),
            );
          } catch (error) {
            if (!(error instanceof Error && 'status' in error && error.status === 403)) throw error;
          }
        }
      }
      if (!staffResponse.ok && !venues.length)
        throw new Error('You do not have permission to manage staff.');
      return {
        venues,
        staff: [
          ...(venues.length
            ? staff.filter(
                (m) => !m.restaurant || !venues.some((v) => v.id === m.restaurant?.venueId),
              )
            : staff),
          ...restaurantRows,
        ].map((member) => ({ ...member, overrides: member.overrides ?? [] })),
        templates,
        usage,
        catalog,
        myCapabilities,
      };
    },
  });
  const load = () => void staffQuery.refetch();
  const {
    staff = [],
    venues = [],
    templates = [],
    usage,
    catalog = [],
    myCapabilities = [],
  } = staffQuery.data ?? {};
  const capped = usage ? usage.usage.staffSeats >= usage.plan.maxStaffSeats : false;

  useEffect(() => {
    const readDetail = () =>
      setDetailId(new URLSearchParams(window.location.search).get('staffUser'));
    readDetail();
    window.addEventListener('popstate', readDetail);
    return () => window.removeEventListener('popstate', readDetail);
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setTicked([]);
    setPage(1);
    setScreen('staff');
    setView('all');
  }, [tenantId, propertyId]);

  const assignMutation = useMutation({
    mutationFn: async ({ userId, roleTemplateId }: { userId: string; roleTemplateId: string }) => {
      const member = staff.find((m) => staffKey(m) === userId);
      const response = await fetch(
        member?.restaurant
          ? `${base}/venues/${member.restaurant.venueId}/staff/${member.userId}`
          : `${base}/properties/${propertyId}/staff/${userId}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(member?.restaurant ? { role: roleTemplateId } : { roleTemplateId }),
        },
      );
      if (!response.ok) throw new Error('Unable to update staff role.');
    },
    onSuccess: (_data, variables) => {
      load();
      void queryClient.invalidateQueries({
        queryKey: [
          'dashboard',
          'staff-effective-capabilities',
          tenantId,
          propertyId,
          variables.userId,
        ],
      });
      toast.success('Staff role updated.');
    },
    onError: () => toast.error('Unable to update staff role.'),
  });
  const overrideMutation = useMutation({
    mutationFn: async ({
      userId,
      key,
      value,
    }: {
      userId: string;
      key: string;
      value: OverrideValue;
    }) => {
      const response = await fetch(
        `${base}/properties/${propertyId}/staff/${userId}/capabilities/${key}`,
        {
          method: value === 'default' ? 'DELETE' : 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: value === 'default' ? undefined : JSON.stringify({ granted: value === 'grant' }),
        },
      );
      if (!response.ok) throw new Error('Unable to update capability override.');
    },
    onSuccess: (_data, variables) => {
      load();
      void queryClient.invalidateQueries({
        queryKey: [
          'dashboard',
          'staff-effective-capabilities',
          tenantId,
          propertyId,
          variables.userId,
        ],
      });
      toast.success('Capability override updated.');
    },
    onError: () => toast.error('Unable to update capability override.'),
  });
  const statusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: 'ACTIVE' | 'SUSPENDED' }) => {
      const member = staff.find((m) => staffKey(m) === userId);
      const response = await fetch(
        member?.restaurant
          ? `${base}/venues/${member.restaurant.venueId}/staff/${member.userId}/${status === 'ACTIVE' ? 'resume' : 'suspend'}`
          : `${base}/properties/${propertyId}/staff/${userId}/status`,
        {
          method: member?.restaurant ? 'POST' : 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );
      if (!response.ok) throw await contractError(response, 'Unable to update staff status.');
    },
    onSuccess: (_data, variables) => {
      load();
      setSuspendTarget(null);
      toast.success(
        variables.status === 'SUSPENDED' ? 'Staff access suspended.' : 'Staff access reactivated.',
      );
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (member: StaffMember) => {
      const response = await fetch(
        `${base}/venues/${member.restaurant!.venueId}/staff/${member.userId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok) throw await contractError(response, 'Unable to remove restaurant access.');
    },
    onSuccess: () => {
      setRemoveTarget(null);
      setSelectedId(null);
      setDetailId(null);
      window.history.replaceState(null, '', staffListHref(tenantId, propertyId));
      load();
      toast.success('Restaurant access removed.');
    },
  });
  const canManageRestaurant = (member: StaffMember) =>
    venues.some((v) => v.id === member.restaurant?.venueId);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const counts = useMemo(
    () => ({
      all: staff.length,
      active: staff.filter((member) => member.status === 'ACTIVE').length,
      suspended: staff.filter((member) => member.status === 'SUSPENDED').length,
      'with-extra': staff.filter((member) => member.overrides.some((item) => item.granted)).length,
      'without-extra': staff.filter((member) => !member.overrides.some((item) => item.granted))
        .length,
    }),
    [staff],
  );
  const filteredStaff = useMemo(
    () =>
      staff.filter((member) => {
        const matchesSearch =
          !normalizedSearch ||
          `${member.firstName ?? ''} ${member.lastName ?? ''} ${member.email} ${member.roleTemplateName}`
            .toLocaleLowerCase()
            .includes(normalizedSearch);
        const matchesView =
          view === 'all' ||
          (view === 'active'
            ? member.status === 'ACTIVE'
            : view === 'suspended'
              ? member.status === 'SUSPENDED'
              : view === 'with-extra'
                ? member.overrides.some((item) => item.granted)
                : !member.overrides.some((item) => item.granted));
        return matchesSearch && matchesView;
      }),
    [normalizedSearch, staff, view],
  );
  const sortedStaff = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...filteredStaff].sort((left, right) => {
      const a = sortValue(left, sort.key);
      const b = sortValue(right, sort.key);
      return (a < b ? -1 : a > b ? 1 : 0) * factor;
    });
  }, [filteredStaff, sort]);
  const pageStaff = sortedStaff.slice((page - 1) * pageSize, page * pageSize);
  const selected = staff.find((member) => staffKey(member) === selectedId) ?? null;
  const detailMember = detailId ? staff.find((member) => staffKey(member) === detailId) : undefined;
  const tickedStaff = staff.filter((member) => ticked.includes(staffKey(member)));
  const allTicked =
    pageStaff.length > 0 && pageStaff.every((member) => ticked.includes(staffKey(member)));
  const someTicked = pageStaff.some((member) => ticked.includes(staffKey(member)));
  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'extra' ? 'desc' : 'asc' },
    );
    setPage(1);
  };
  const selectView = (next: string) => {
    setView(next as StaffView);
    setPage(1);
  };
  const setSearchValue = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const tick = (userId: string, checked: boolean) =>
    setTicked((current) =>
      checked ? [...new Set([...current, userId])] : current.filter((id) => id !== userId),
    );
  const tickAll = (checked: boolean) =>
    setTicked((current) => {
      const pageIds = pageStaff.map(staffKey);
      return checked
        ? [...new Set([...current, ...pageIds])]
        : current.filter((id) => !pageIds.includes(id));
    });
  const copyEmails = async (members: StaffMember[]) => {
    try {
      await navigator.clipboard.writeText(members.map((member) => member.email).join('\n'));
      setNotice(`Copied ${members.length} email${members.length === 1 ? '' : 's'}.`);
    } catch {
      setNotice('Could not copy. Select the emails manually.');
    }
  };
  const requestStatusChange = (member: StaffMember) => {
    setSelectedId(null);
    window.setTimeout(() => setSuspendTarget(member), 0);
  };
  const canCreateStaff = myCapabilities.includes('staff.create') || venues.length > 0;

  if (staffQuery.isPending)
    return (
      <div className="space-y-5">
        <PageHeader title="Staff" description="Hotel and restaurant staff access." />
        <ListSkeleton rows={6} />
      </div>
    );

  if (staffQuery.error)
    return (
      <div className="space-y-5">
        <PageHeader title="Staff" description="Hotel and restaurant staff access." />
        <ErrorPanel
          title="Staff could not be loaded"
          description={staffQuery.error.message}
          onRetry={load}
        />
      </div>
    );

  if (detailId) {
    if (!detailMember)
      return (
        <div className="space-y-5">
          <PageHeader title="Staff details" />
          <EmptyPanel
            title="Staff member not found"
            description="This account is not assigned to the selected hotel."
            action={
              <Button variant="outline" size="sm" asChild>
                <a href={staffListHref(tenantId, propertyId)}>Back to staff</a>
              </Button>
            }
          />
        </div>
      );

    return (
      <>
        {detailMember.restaurant ? (
          <RestaurantStaffProfile
            full
            member={detailMember}
            tenantId={tenantId}
            propertyId={propertyId}
            canManage={canManageRestaurant(detailMember)}
            pending={
              assignMutation.isPending || statusMutation.isPending || removeMutation.isPending
            }
            onClose={() => setDetailId(null)}
            onChangeRole={(roleTemplateId) =>
              assignMutation.mutate({ userId: staffKey(detailMember), roleTemplateId })
            }
            onChangeStatus={() => requestStatusChange(detailMember)}
            onRemove={() => setRemoveTarget(detailMember)}
          />
        ) : (
          <StaffDetail
            tenantId={tenantId}
            propertyId={propertyId}
            member={detailMember}
            templates={templates}
            catalog={catalog}
            myCapabilities={myCapabilities}
            roleChangePending={
              assignMutation.isPending && assignMutation.variables?.userId === detailMember.userId
            }
            pendingOverride={
              overrideMutation.isPending &&
              overrideMutation.variables?.userId === detailMember.userId
                ? overrideMutation.variables.key
                : undefined
            }
            statusPending={
              statusMutation.isPending && statusMutation.variables?.userId === detailMember.userId
            }
            onChangeRole={(roleTemplateId) =>
              assignMutation.mutate({ userId: detailMember.userId, roleTemplateId })
            }
            onChangeOverride={(key, value) =>
              overrideMutation.mutate({ userId: detailMember.userId, key, value })
            }
            onChangeStatus={() => requestStatusChange(detailMember)}
          />
        )}
        {removeTarget ? (
          <ConfirmDialog
            open
            onOpenChange={(open) => !open && setRemoveTarget(null)}
            title="Remove restaurant access?"
            description="This removes only this restaurant assignment. Other access is preserved."
            confirmLabel="Remove access"
            destructive
            onConfirm={() => removeMutation.mutateAsync(removeTarget)}
          />
        ) : null}
        <StaffStatusDialog
          target={suspendTarget}
          pending={statusMutation.isPending}
          onClose={() => setSuspendTarget(null)}
          onConfirm={async () => {
            if (!suspendTarget) return;
            await statusMutation.mutateAsync({
              userId: staffKey(suspendTarget),
              status: suspendTarget.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
            });
          }}
        />
      </>
    );
  }

  if (screen === 'roles')
    return (
      <div className="space-y-5">
        <TabBar
          tabs={[
            { id: 'staff', label: 'Staff', count: staff.length },
            ...(templates.length || venues.length
              ? [{ id: 'roles', label: 'Roles', count: templates.length + (venues.length ? 2 : 0) }]
              : []),
          ]}
          current={screen}
          onSelect={(value) => setScreen(value as 'staff' | 'roles')}
          label="Staff sections"
        />
        <RoleManagement
          restaurantRoles={venues.length ? restaurantRoleRows(staff) : []}
          tenantId={tenantId}
          propertyId={propertyId}
          templates={templates}
          catalog={catalog}
          myCapabilities={myCapabilities}
          onChanged={load}
        />
      </div>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff"
        description="Manage hotel and restaurant assignments and role access."
        actions={
          <>
            <Button variant="outline" asChild>
              <a
                href={`/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=audit`}
              >
                Activity and audit log
              </a>
            </Button>
            <Button
              variant="outline"
              disabled
              title="Staff export is unavailable until the permission-gated, audited export is built (G21)."
            >
              Export CSV
            </Button>
            {canCreateStaff ? (
              <Button
                onClick={() => setAddStaffOpen(true)}
                disabled={capped || (templates.length === 0 && venues.length === 0)}
                title={capped ? 'The staff seat limit has been reached.' : undefined}
              >
                Add staff
              </Button>
            ) : null}
          </>
        }
      />

      <TabBar
        tabs={[
          { id: 'staff', label: 'Staff', count: staff.length },
          ...(templates.length || venues.length
            ? [{ id: 'roles', label: 'Roles', count: templates.length + (venues.length ? 2 : 0) }]
            : []),
        ]}
        current={screen}
        onSelect={(value) => setScreen(value as 'staff' | 'roles')}
        label="Staff sections"
      />

      {capped ? (
        <p
          role="status"
          className="m-0 rounded-lg border border-warning/30 bg-warning-surface px-4 py-3 text-sm text-warning"
        >
          The plan staff-seat limit has been reached. Upgrade to invite another staff member.
        </p>
      ) : null}

      <div className="overflow-clip rounded-xl border bg-card">
        <div className="space-y-3 border-b p-4">
          <TabBar
            tabs={[
              { id: 'all', label: 'All staff', count: counts.all },
              { id: 'active', label: 'Active', count: counts.active },
              { id: 'suspended', label: 'Suspended', count: counts.suspended },
              { id: 'with-extra', label: 'With extra permissions', count: counts['with-extra'] },
              {
                id: 'without-extra',
                label: 'No extra permissions',
                count: counts['without-extra'],
              },
            ]}
            current={view}
            onSelect={selectView}
            label="Staff views"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SearchInput
              aria-label="Search staff"
              className="w-full sm:w-80"
              value={search}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Email or role"
            />
            <ColumnChooser labels={COLUMN_LABELS} visible={columns} onToggle={toggleColumn} />
            <DensityToggle compact={density === 'compact'} onToggle={toggleDensity} />
          </div>
          <FilterChips
            chips={[
              ...(search.trim() ? [{ key: 'search', label: `Search: ${search.trim()}` }] : []),
              ...(view === 'all'
                ? []
                : [
                    {
                      key: 'view',
                      label:
                        view === 'active'
                          ? 'Active'
                          : view === 'suspended'
                            ? 'Suspended'
                            : view === 'with-extra'
                              ? 'With extra permissions'
                              : 'No extra permissions',
                    },
                  ]),
            ]}
            onRemove={(key) => (key === 'search' ? setSearchValue('') : selectView('all'))}
            onClearAll={() => {
              setSearchValue('');
              selectView('all');
            }}
          />
          <BulkBar count={tickedStaff.length} noun="staff selected" onClear={() => setTicked([])}>
            <Button variant="outline" size="sm" onClick={() => void copyEmails(tickedStaff)}>
              Copy emails
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Staff export requires the permission-gated, audited export path (G21)."
            >
              Export selected
            </Button>
          </BulkBar>
          {notice ? (
            <p role="status" className="m-0 text-xs text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </div>

        {staff.length === 0 ? (
          <div className="p-4">
            <EmptyPanel
              title="No staff assigned yet"
              description="Staff accounts appear here after creation or invitation acceptance."
              action={
                canCreateStaff ? (
                  <Button
                    size="sm"
                    onClick={() => setAddStaffOpen(true)}
                    disabled={capped || (templates.length === 0 && venues.length === 0)}
                  >
                    Add staff
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : sortedStaff.length === 0 ? (
          <div className="p-4">
            <NoResultsPanel
              onClear={() => {
                setSearchValue('');
                selectView('all');
              }}
            />
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
                      aria-label="Select all staff on this page"
                      checked={allTicked ? true : someTicked ? 'indeterminate' : false}
                      onCheckedChange={(value) => tickAll(value === true)}
                    />
                  </TableHead>
                  <SortableTableHead
                    label="Staff member"
                    active={sort.key === 'member'}
                    direction={sort.direction}
                    onSort={() => toggleSort('member')}
                  />
                  {columns.role ? (
                    <SortableTableHead
                      label="Role"
                      active={sort.key === 'role'}
                      direction={sort.direction}
                      onSort={() => toggleSort('role')}
                    />
                  ) : null}
                  {columns.extra ? (
                    <SortableTableHead
                      label="Extra permissions"
                      active={sort.key === 'extra'}
                      direction={sort.direction}
                      onSort={() => toggleSort('extra')}
                      align="right"
                    />
                  ) : null}
                  {columns.status ? (
                    <SortableTableHead
                      label="Status"
                      active={sort.key === 'status'}
                      direction={sort.direction}
                      onSort={() => toggleSort('status')}
                    />
                  ) : null}
                  {columns.lastActive ? (
                    <SortableTableHead
                      label="Last active"
                      active={sort.key === 'last-active'}
                      direction={sort.direction}
                      onSort={() => toggleSort('last-active')}
                    />
                  ) : null}
                  <TableHead className="w-10 px-2 py-2 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageStaff.map((member) => {
                  const isTicked = ticked.includes(staffKey(member));
                  const template = templates.find(
                    (candidate) => candidate.id === member.roleTemplateId,
                  );
                  return (
                    <TableRow
                      key={staffKey(member)}
                      data-state={isTicked ? 'selected' : undefined}
                      className={cn(
                        'h-14 cursor-pointer group-data-[density=compact]:h-10',
                        isTicked && 'bg-primary/10 hover:bg-primary/10',
                      )}
                      onClick={(event) => {
                        if (
                          (event.target as HTMLElement).closest(
                            'button, a, input, label, [role="checkbox"], [role="menuitem"]',
                          )
                        )
                          return;
                        setSelectedId(staffKey(member));
                      }}
                    >
                      <TableCell className="px-3 py-2">
                        <Checkbox
                          aria-label={`Select ${member.email}`}
                          checked={isTicked}
                          onCheckedChange={(value) => tick(staffKey(member), value === true)}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar>
                            <AvatarFallback>
                              {(
                                member.firstName?.slice(0, 1) || member.email.slice(0, 1)
                              ).toLocaleUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setSelectedId(staffKey(member))}
                              aria-label={`Show details for ${member.email}`}
                              className="block max-w-full truncate bg-transparent p-0 text-left text-[12px] font-semibold text-foreground hover:underline"
                            >
                              {[member.firstName, member.lastName].filter(Boolean).join(' ') ||
                                member.email}
                            </button>
                            <span className="block truncate text-[10px] text-muted-foreground group-data-[density=compact]:hidden">
                              {member.email}
                            </span>
                          </span>
                        </div>
                      </TableCell>
                      {columns.role ? (
                        <TableCell className="px-2 py-2">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary">
                              {template?.name ?? member.roleTemplateName}
                            </Badge>
                            {member.restaurant ? (
                              <Badge variant="outline" title={member.restaurant.venueName}>
                                Restaurant
                              </Badge>
                            ) : null}
                          </span>
                        </TableCell>
                      ) : null}
                      {columns.extra ? (
                        <TableCell className="px-2 py-2 text-right tabular-nums">
                          {member.overrides.some((item) => item.granted) ? (
                            <Badge variant="warning">
                              {member.overrides.filter((item) => item.granted).length}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </TableCell>
                      ) : null}
                      {columns.status ? (
                        <TableCell className="px-2 py-2">
                          <Badge variant={member.status === 'ACTIVE' ? 'success' : 'danger'}>
                            {member.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                          </Badge>
                        </TableCell>
                      ) : null}
                      {columns.lastActive ? (
                        <TableCell className="px-2 py-2 text-muted-foreground">
                          {formatLastActive(member.lastActiveAt)}
                        </TableCell>
                      ) : null}
                      <TableCell className="px-2 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`More actions for ${member.email}`}
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setSelectedId(staffKey(member))}>
                              Quick peek
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={staffHref(tenantId, propertyId, staffKey(member))}>
                                Open staff details
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void copyEmails([member])}>
                              Copy email
                            </DropdownMenuItem>
                            {(
                              member.restaurant
                                ? canManageRestaurant(member)
                                : myCapabilities.includes('staff.suspend')
                            ) ? (
                              <DropdownMenuItem
                                variant={member.status === 'ACTIVE' ? 'destructive' : 'default'}
                                onSelect={() => requestStatusChange(member)}
                              >
                                {member.status === 'ACTIVE'
                                  ? 'Suspend access…'
                                  : 'Reactivate access…'}
                              </DropdownMenuItem>
                            ) : null}
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
              total={sortedStaff.length}
              onPage={setPage}
              noun="staff members"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </div>

      {selected?.restaurant ? (
        <RestaurantStaffProfile
          member={selected}
          tenantId={tenantId}
          propertyId={propertyId}
          canManage={canManageRestaurant(selected)}
          pending={assignMutation.isPending || statusMutation.isPending || removeMutation.isPending}
          onClose={() => setSelectedId(null)}
          onChangeRole={(roleTemplateId) =>
            assignMutation.mutate({ userId: staffKey(selected), roleTemplateId })
          }
          onChangeStatus={() => requestStatusChange(selected)}
          onRemove={() => {
            setSelectedId(null);
            window.setTimeout(() => setRemoveTarget(selected), 0);
          }}
        />
      ) : (
        <StaffSheet
          member={selected}
          template={
            selected
              ? templates.find((candidate) => candidate.id === selected.roleTemplateId)
              : undefined
          }
          tenantId={tenantId}
          propertyId={propertyId}
          catalog={catalog}
          myCapabilities={myCapabilities}
          pendingOverride={
            overrideMutation.isPending && overrideMutation.variables?.userId === selected?.userId
              ? overrideMutation.variables.key
              : undefined
          }
          statusPending={
            statusMutation.isPending && statusMutation.variables?.userId === selected?.userId
          }
          onClose={() => setSelectedId(null)}
          onChangeOverride={(key, value) => {
            if (selected) overrideMutation.mutate({ userId: selected.userId, key, value });
          }}
          onChangeStatus={() => {
            if (selected) requestStatusChange(selected);
          }}
        />
      )}
      {removeTarget ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoveTarget(null)}
          title="Remove restaurant access?"
          description="This removes only this restaurant assignment. Other access is preserved."
          confirmLabel="Remove access"
          destructive
          onConfirm={() => removeMutation.mutateAsync(removeTarget)}
        />
      ) : null}

      <AddStaffDialog
        open={addStaffOpen}
        onOpenChange={setAddStaffOpen}
        tenantId={tenantId}
        propertyId={propertyId}
        templates={templates}
        venues={venues}
        catalog={catalog}
        myCapabilities={myCapabilities}
        capped={capped}
        onCreated={() => {
          load();
          toast.success('Staff account created.');
        }}
        onInvited={() => {
          load();
          toast.success('Invitation sent.');
        }}
      />

      <StaffStatusDialog
        target={suspendTarget}
        pending={statusMutation.isPending}
        onClose={() => setSuspendTarget(null)}
        onConfirm={async () => {
          if (!suspendTarget) return;
          await statusMutation.mutateAsync({
            userId: staffKey(suspendTarget),
            status: suspendTarget.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
          });
        }}
      />
    </div>
  );
}

function AddStaffDialog({
  open,
  onOpenChange,
  tenantId,
  propertyId,
  templates,
  venues,
  catalog,
  myCapabilities,
  capped,
  onCreated,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  propertyId: string;
  templates: StaffTemplate[];
  venues: Venue[];
  catalog: PermissionCatalogItem[];
  myCapabilities: string[];
  capped: boolean;
  onCreated: () => void;
  onInvited: () => void;
}) {
  const [venueId, setVenueId] = useState('');
  const [tab, setTab] = useState<'create' | 'invite'>('create');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createRoleId, setCreateRoleId] = useState('');
  const [password, setPassword] = useState('');
  const [extraCapabilities, setExtraCapabilities] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviteExtraCapabilities, setInviteExtraCapabilities] = useState<string[]>([]);
  const [created, setCreated] = useState<{ email: string; password: string | null } | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const base = `/api/tenants/${tenantId}`;
  const selectedCreateRole = createRoleId || templates[0]?.id || (venues.length ? 'HOST' : '');
  const selectedInviteRole = inviteRoleId || templates[0]?.id || (venues.length ? 'HOST' : '');
  const restaurantCreate = ['HOST', 'MANAGER'].includes(selectedCreateRole);
  const restaurantInvite = ['HOST', 'MANAGER'].includes(selectedInviteRole);
  const selectedVenue = venueId || venues[0]?.id || '';
  const permissionOptions = permissionMultiSelectOptions(catalog, myCapabilities);
  const validPassword = password.length >= 12 && /[a-z]/i.test(password) && /\d/.test(password);

  const reset = () => {
    setTab('create');
    setVenueId('');
    setFirstName('');
    setLastName('');
    setCreateEmail('');
    setCreateRoleId('');
    setPassword('');
    setExtraCapabilities([]);
    setInviteEmail('');
    setInviteRoleId('');
    setInviteExtraCapabilities([]);
    setCreated(null);
    setCopyStatus('');
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const email = createEmail.trim();
      const ownerChosenPassword = password;
      const response = await fetch(
        restaurantCreate
          ? `${base}/venues/${selectedVenue}/staff`
          : `${base}/properties/${propertyId}/staff`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: firstName.trim(),
            ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
            email,
            password: ownerChosenPassword,
            ...(restaurantCreate
              ? { role: selectedCreateRole }
              : {
                  roleTemplateId: selectedCreateRole,
                  ...(extraCapabilities.length ? { extraCapabilities } : {}),
                }),
          }),
        },
      );
      if (!response.ok) {
        if (response.status === 409)
          throw new Error('That email already has an account. Send an invitation instead.');
        throw new Error('Could not create this staff account.');
      }
      const result = (await response.json()) as { userId?: string };
      if (!result.userId) throw new Error('Could not create this staff account.');
      setCreated({ email, password: ownerChosenPassword });
      setPassword('');
      setFirstName('');
      setLastName('');
      setCreateEmail('');
      setExtraCapabilities([]);
      return result.userId;
    },
    onSuccess: onCreated,
    onError: (error: Error) => toast.error(error.message),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        restaurantInvite
          ? `${base}/venues/${selectedVenue}/staff/invitations`
          : `${base}/properties/${propertyId}/staff-invitations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: inviteEmail.trim(),
            ...(restaurantInvite
              ? { role: selectedInviteRole }
              : {
                  roleTemplateId: selectedInviteRole,
                  ...(inviteExtraCapabilities.length
                    ? { capabilityKeys: inviteExtraCapabilities }
                    : {}),
                }),
          }),
        },
      );
      if (!response.ok) throw new Error('Could not send the invitation.');
    },
    onSuccess: () => {
      onInvited();
      reset();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (createMutation.isPending || inviteMutation.isPending)) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const copyCreatedPassword = async () => {
    if (!created?.password) return;
    try {
      await navigator.clipboard.writeText(created.password);
      setCreated({ email: created.email, password: null });
      setCopyStatus('Password copied once and cleared from this screen.');
    } catch {
      setCopyStatus('Could not copy the password. You can try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{created ? 'Staff account created' : 'Add staff'}</DialogTitle>
          <DialogDescription>
            {created
              ? 'The password is shown only as a one-time copy action.'
              : 'Create an account or invite someone to a hotel or restaurant.'}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-4">
            <p className="m-0 text-sm">
              Account created for <strong>{created.email}</strong>.
            </p>
            <p className="m-0 text-sm text-muted-foreground">
              Copy the password now. It will not be shown or returned by the server.
            </p>
            {created.password ? (
              <Button type="button" onClick={() => void copyCreatedPassword()}>
                <Copy aria-hidden="true" /> Copy password once
              </Button>
            ) : (
              <p role="status" className="m-0 text-sm text-success">
                {copyStatus || 'Password copied once and cleared from this screen.'}
              </p>
            )}
            {copyStatus && created.password ? (
              <p role="status" className="m-0 text-xs text-muted-foreground">
                {copyStatus}
              </p>
            ) : null}
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <TabBar
              tabs={[
                { id: 'create', label: 'Create account' },
                { id: 'invite', label: 'Send invitation' },
              ]}
              current={tab}
              onSelect={(value) => setTab(value as 'create' | 'invite')}
              label="Add staff options"
            />
            {tab === 'create' ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="First name" htmlFor="staff-create-first-name" required>
                    <Input
                      id="staff-create-first-name"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                    />
                  </FormField>
                  <FormField label="Last name" htmlFor="staff-create-last-name">
                    <Input
                      id="staff-create-last-name"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                    />
                  </FormField>
                </div>
                <FormField label="Email" htmlFor="staff-create-email" required>
                  <Input
                    id="staff-create-email"
                    type="email"
                    autoComplete="email"
                    value={createEmail}
                    onChange={(event) => setCreateEmail(event.target.value)}
                  />
                </FormField>
                <FormField label="Role" htmlFor="staff-create-role" required>
                  <Select
                    value={selectedCreateRole}
                    onValueChange={setCreateRoleId}
                    disabled={templates.length === 0 && venues.length === 0}
                  >
                    <SelectTrigger
                      id="staff-create-role"
                      aria-label="Create staff role"
                      className="w-full"
                    >
                      <SelectValue placeholder="Choose a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {venues.length
                        ? VENUE_ROLE_OPTIONS.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              {role.label}
                            </SelectItem>
                          ))
                        : null}
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Password" htmlFor="staff-create-password" required>
                  <PasswordField
                    id="staff-create-password"
                    value={password}
                    onChange={setPassword}
                  />
                </FormField>
                {restaurantCreate ? (
                  <FormField label="Restaurant" required>
                    <Select value={selectedVenue} onValueChange={setVenueId}>
                      <SelectTrigger aria-label="Restaurant">
                        <SelectValue placeholder="Choose a restaurant" />
                      </SelectTrigger>
                      <SelectContent>
                        {venues.map((venue) => (
                          <SelectItem key={venue.id} value={venue.id}>
                            {venue.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                ) : null}
                {!restaurantCreate ? (
                  <section className="space-y-2">
                    <div className="space-y-1">
                      <h3 className="m-0 text-sm font-semibold">Optional extra permissions</h3>
                      <p className="m-0 text-xs text-muted-foreground">
                        Extra permissions add to the selected role. Denials can be set on the staff
                        detail page.
                      </p>
                    </div>
                    <MultiSelect
                      options={permissionOptions}
                      value={extraCapabilities}
                      onChange={setExtraCapabilities}
                      placeholder="Choose extra permissions"
                      label="Extra permissions"
                    />
                  </section>
                ) : null}
                {capped ? (
                  <p role="alert" className="m-0 text-sm text-warning">
                    This plan has reached its staff-seat limit.
                  </p>
                ) : null}
                {createMutation.isError ? (
                  <p role="alert" className="m-0 text-sm text-destructive">
                    {createMutation.error.message}
                  </p>
                ) : null}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    loading={createMutation.isPending}
                    disabled={
                      capped ||
                      !firstName.trim() ||
                      !createEmail.trim() ||
                      !selectedCreateRole ||
                      (restaurantCreate && !selectedVenue) ||
                      !validPassword
                    }
                    onClick={() => createMutation.mutate()}
                  >
                    Create account
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4">
                <FormField label="Work email" htmlFor="staff-invite-email" required>
                  <Input
                    id="staff-invite-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                  />
                </FormField>
                <FormField label="Role" htmlFor="staff-invite-role" required>
                  <Select
                    value={selectedInviteRole}
                    onValueChange={setInviteRoleId}
                    disabled={templates.length === 0 && venues.length === 0}
                  >
                    <SelectTrigger
                      id="staff-invite-role"
                      aria-label="Invite role"
                      className="w-full"
                    >
                      <SelectValue placeholder="Choose a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {venues.length
                        ? VENUE_ROLE_OPTIONS.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              {role.label}
                            </SelectItem>
                          ))
                        : null}
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                {restaurantInvite ? (
                  <FormField label="Restaurant" required>
                    <Select value={selectedVenue} onValueChange={setVenueId}>
                      <SelectTrigger aria-label="Restaurant">
                        <SelectValue placeholder="Choose a restaurant" />
                      </SelectTrigger>
                      <SelectContent>
                        {venues.map((venue) => (
                          <SelectItem key={venue.id} value={venue.id}>
                            {venue.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                ) : null}
                {!restaurantInvite ? (
                  <section className="space-y-2">
                    <div className="space-y-1">
                      <h3 className="m-0 text-sm font-semibold">Optional extra permissions</h3>
                      <p className="m-0 text-xs text-muted-foreground">
                        Extra permissions add to the selected role.
                      </p>
                    </div>
                    <MultiSelect
                      options={permissionOptions}
                      value={inviteExtraCapabilities}
                      onChange={setInviteExtraCapabilities}
                      placeholder="Choose extra permissions"
                      label="Invitation extra permissions"
                    />
                  </section>
                ) : null}
                <p className="m-0 text-xs text-muted-foreground">
                  The invitation link expires after seven days. Staff set their password when they
                  accept.
                </p>
                {capped ? (
                  <p role="alert" className="m-0 text-sm text-warning">
                    This plan has reached its staff-seat limit.
                  </p>
                ) : null}
                {inviteMutation.isError ? (
                  <p role="alert" className="m-0 text-sm text-destructive">
                    {inviteMutation.error.message}
                  </p>
                ) : null}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    loading={inviteMutation.isPending}
                    disabled={
                      capped ||
                      !inviteEmail.trim() ||
                      !selectedInviteRole ||
                      (restaurantInvite && !selectedVenue)
                    }
                    onClick={() => inviteMutation.mutate()}
                  >
                    Send invitation
                  </Button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const OVERVIEW_TYPE_OPTIONS = [
  { value: 'auto', label: 'Automatic', hint: "Chosen from the role's permissions." },
  {
    value: 'owner_manager',
    label: 'Owner / Manager',
    hint: 'Hotel health, approvals, alerts, arrivals and departures.',
  },
  {
    value: 'front_desk',
    label: 'Front desk',
    hint: 'Arrivals, departures, in house, unpaid bookings, quick booking.',
  },
  {
    value: 'finance',
    label: 'Finance',
    hint: 'Payments needing action, refunds, money still owed.',
  },
  {
    value: 'reservations',
    label: 'Reservations',
    hint: 'New bookings, requests, cancellations, upcoming arrivals.',
  },
  { value: 'minimal', label: 'Minimal', hint: 'Only their own tasks and the date.' },
] as const;

function restaurantRoleRows(
  staff: StaffMember[],
): Array<RestaurantRoleRow & { memberCount: number }> {
  return RESTAURANT_ROLE_ROWS.map((role) => ({
    ...role,
    memberCount: staff.filter((member) => member.restaurant?.role === role.value).length,
  }));
}

function RoleManagement({
  restaurantRoles,
  tenantId,
  propertyId,
  templates,
  catalog,
  myCapabilities,
  onChanged,
}: {
  restaurantRoles: Array<RestaurantRoleRow & { memberCount: number }>;
  tenantId: string;
  propertyId: string;
  templates: StaffTemplate[];
  catalog: PermissionCatalogItem[];
  myCapabilities: string[];
  onChanged: () => void;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/role-templates`;
  const [dialog, setDialog] = useState<
    { mode: 'create'; copyFromId?: string } | { mode: 'edit'; role: StaffTemplate } | null
  >(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [overviewType, setOverviewType] = useState('auto');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [viewingRole, setViewingRole] = useState<StaffTemplate | null>(null);
  const [viewingRestaurantRole, setViewingRestaurantRole] = useState<RestaurantRoleRow | null>(
    null,
  );
  const [roleFilter, setRoleFilter] = useState<'all' | 'hotel' | 'restaurant'>('all');
  const permissionOptions = permissionMultiSelectOptions(catalog, myCapabilities);
  const lockedKeys = capabilities.filter((key) => !myCapabilities.includes(key));

  const reset = () => {
    setDialog(null);
    setName('');
    setDescription('');
    setOverviewType('auto');
    setCapabilities([]);
    saveMutation.reset();
  };
  const beginCreate = () => {
    saveMutation.reset();
    setName('');
    setDescription('');
    setOverviewType('auto');
    setCapabilities([]);
    setDialog({ mode: 'create' });
  };
  const beginCopy = (role: StaffTemplate) => {
    saveMutation.reset();
    setName(`${role.name} copy`);
    setDescription(role.description ?? '');
    setOverviewType(role.overviewType ?? 'auto');
    setCapabilities(role.capabilities.filter((key) => myCapabilities.includes(key)));
    setDialog({ mode: 'create', copyFromId: role.id });
  };
  const beginEdit = (role: StaffTemplate) => {
    saveMutation.reset();
    setName(role.name);
    setDescription(role.description ?? '');
    setOverviewType(role.overviewType ?? 'auto');
    setCapabilities(role.capabilities);
    setDialog({ mode: 'edit', role });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!dialog) throw new Error('Choose a role to save.');
      const body = {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        capabilities,
        overviewType,
        ...(dialog.mode === 'create' && dialog.copyFromId ? { copyFromId: dialog.copyFromId } : {}),
      };
      const response = await fetch(dialog.mode === 'edit' ? `${base}/${dialog.role.id}` : base, {
        method: dialog.mode === 'edit' ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw await contractError(response, 'Could not save the role.');
    },
    onSuccess: () => {
      reset();
      onChanged();
      toast.success(dialog?.mode === 'edit' ? 'Role updated.' : 'Custom role created.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const response = await fetch(`${base}/${roleId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw await contractError(response, 'Could not delete the role.');
    },
    onSuccess: () => {
      onChanged();
      toast.success('Custom role deleted.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles"
        description="Hotel roles belong to this hotel; restaurant roles apply to one restaurant. Built-in roles stay locked."
        actions={
          <div className="flex items-center gap-2">
            {restaurantRoles.length ? (
              <Select
                value={roleFilter}
                onValueChange={(value) => setRoleFilter(value as 'all' | 'hotel' | 'restaurant')}
              >
                <SelectTrigger aria-label="Filter roles" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="hotel">Hotel roles</SelectItem>
                  <SelectItem value="restaurant">Restaurant roles</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {myCapabilities.includes('staff.manage_roles') ? (
              <Button onClick={beginCreate}>New custom role</Button>
            ) : null}
          </div>
        }
      />
      {deleteMutation.isError ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {deleteMutation.error.message}
        </p>
      ) : null}
      {templates.length === 0 && restaurantRoles.length === 0 ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          No roles are available for this hotel.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {(roleFilter === 'restaurant' ? [] : templates).map((role) => {
            const builtIn = role.kind === 'BUILT_IN';
            const blocked = role.memberCount > 0;
            return (
              <Card key={role.id}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{role.name}</CardTitle>
                    {role.description ? (
                      <p className="m-0 text-sm text-muted-foreground">{role.description}</p>
                    ) : null}
                  </div>
                  <Badge variant={builtIn ? 'secondary' : 'info'}>
                    {builtIn ? 'Built-in' : 'Custom'}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{role.memberCount} staff members</span>
                    <span aria-hidden="true">·</span>
                    <span>{role.capabilities.length} permissions</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Overview:{' '}
                      {OVERVIEW_TYPE_OPTIONS.find((o) => o.value === (role.overviewType ?? 'auto'))
                        ?.label ?? 'Automatic'}
                    </span>
                  </div>
                  {blocked && !builtIn ? (
                    <p className="m-0 text-xs text-warning">
                      Cannot delete while {role.memberCount} staff member
                      {role.memberCount === 1 ? '' : 's'} use this role.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {builtIn ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setViewingRole(role)}>
                          View permissions
                        </Button>
                        {myCapabilities.includes('staff.manage_roles') ? (
                          <Button size="sm" variant="outline" onClick={() => beginCopy(role)}>
                            Copy as custom role
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {myCapabilities.includes('staff.manage_roles') ? (
                          <Button size="sm" variant="outline" onClick={() => beginEdit(role)}>
                            Edit role
                          </Button>
                        ) : null}
                        {myCapabilities.includes('staff.manage_roles') ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={blocked || deleteMutation.isPending}
                            title={
                              blocked
                                ? `Cannot delete: ${role.memberCount} staff members use this role.`
                                : undefined
                            }
                            onClick={() => deleteMutation.mutate(role.id)}
                          >
                            Delete role
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(roleFilter === 'hotel' ? [] : restaurantRoles).map((role) => (
            <Card key={role.value}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">{role.name}</CardTitle>
                  <p className="m-0 text-sm text-muted-foreground">{role.description}</p>
                </div>
                <div className="flex gap-1">
                  <Badge variant="secondary">Built-in</Badge>
                  <Badge variant="outline">Restaurant</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{role.memberCount} staff members</span>
                  <span aria-hidden="true">·</span>
                  <span>{role.capabilities.length} permissions</span>
                  <span aria-hidden="true">·</span>
                  <span>Overview: Automatic</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setViewingRestaurantRole(role)}
                  >
                    View permissions
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={viewingRestaurantRole !== null}
        onOpenChange={(open) => !open && setViewingRestaurantRole(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewingRestaurantRole?.name} permissions</DialogTitle>
            <DialogDescription>
              Built-in roles are read-only. Restaurant roles apply to the restaurant the person is
              assigned to.
            </DialogDescription>
          </DialogHeader>
          <PermissionList
            ariaLabel={`${viewingRestaurantRole?.name ?? 'Restaurant role'} permissions`}
            permissions={
              viewingRestaurantRole
                ? RESTAURANT_PERMISSION_CATALOG.filter((permission) =>
                    viewingRestaurantRole.capabilities.includes(permission.key),
                  ).map((permission) => ({ ...permission, source: 'Role' as const }))
                : []
            }
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setViewingRestaurantRole(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && reset()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? 'Edit custom role'
                : dialog?.copyFromId
                  ? 'Copy as custom role'
                  : 'Create custom role'}
            </DialogTitle>
            <DialogDescription>
              Choose a name and the permissions this role grants.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="Role name" htmlFor="staff-role-name" required>
              <Input
                id="staff-role-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField label="Description" htmlFor="staff-role-description">
              <Input
                id="staff-role-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
            <FormField
              label="Overview type"
              htmlFor="staff-role-overview"
              hint={
                OVERVIEW_TYPE_OPTIONS.find((o) => o.value === overviewType)?.hint +
                ' Parts that need a permission this role does not have are hidden automatically.'
              }
            >
              <Select value={overviewType} onValueChange={setOverviewType}>
                <SelectTrigger
                  id="staff-role-overview"
                  aria-label="Overview type"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OVERVIEW_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <MultiSelect
              options={permissionOptions}
              value={capabilities}
              onChange={setCapabilities}
              placeholder="Choose role permissions"
              label="Role permissions"
            />
            {lockedKeys.length ? (
              <p role="alert" className="m-0 text-sm text-warning">
                This role includes permissions you do not have. You cannot save it until those
                permissions are removed or assigned to you.
              </p>
            ) : null}
            {saveMutation.isError ? (
              <p role="alert" className="m-0 text-sm text-destructive">
                {saveMutation.error.message}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button
                type="button"
                loading={saveMutation.isPending}
                disabled={!name.trim() || lockedKeys.length > 0}
                onClick={() => saveMutation.mutate()}
              >
                Save role
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={viewingRole !== null} onOpenChange={(open) => !open && setViewingRole(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewingRole?.name} permissions</DialogTitle>
            <DialogDescription>
              Built-in roles are read-only. Copy this role to customize its permissions.
            </DialogDescription>
          </DialogHeader>
          <PermissionList
            ariaLabel={`${viewingRole?.name ?? 'Built-in role'} permissions`}
            permissions={
              viewingRole
                ? catalog
                    .filter((permission) => viewingRole.capabilities.includes(permission.key))
                    .map((permission) => ({ ...permission, source: 'Role' as const }))
                : []
            }
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setViewingRole(null)}>
              Close
            </Button>
            {myCapabilities.includes('staff.manage_roles') ? (
              <Button
                type="button"
                onClick={() => {
                  if (!viewingRole) return;
                  const role = viewingRole;
                  setViewingRole(null);
                  beginCopy(role);
                }}
              >
                Copy as custom role
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function contractError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message) return new Error(body.message);
  } catch {
    // Use the generic operation message when the server returns no JSON body.
  }
  return new Error(fallback);
}

function StaffStatusDialog({
  target,
  pending,
  onClose,
  onConfirm,
}: {
  target: StaffMember | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const suspending = target?.status === 'ACTIVE';
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={suspending ? 'Suspend staff access' : 'Reactivate staff access'}
      description={
        target ? (
          <>
            {suspending ? 'Suspend access for ' : 'Reactivate access for '}
            <strong>{target.email}</strong>?
          </>
        ) : null
      }
      confirmLabel={suspending ? 'Suspend staff' : 'Reactivate staff'}
      destructive={suspending}
      confirmDisabled={pending}
      onConfirm={onConfirm}
    >
      <p className="m-0 rounded-md border bg-muted p-3 text-sm text-muted-foreground">
        {target?.restaurant
          ? suspending
            ? 'This suspends only this restaurant assignment. Other hotel and restaurant access stays available.'
            : 'Access to this restaurant is restored.'
          : suspending
            ? 'Suspending blocks sign-in and ends active sessions. Staff history stays available.'
            : 'The staff account can sign in again after it is reactivated.'}
      </p>
    </ConfirmDialog>
  );
}
