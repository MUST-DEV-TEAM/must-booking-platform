'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
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
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { QuickPeek } from '../../components/ui/quick-peek';
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

type Usage = { plan: { maxStaffSeats: number }; usage: { staffSeats: number } };
type StaffView = 'all' | 'with-overrides' | 'without-overrides';
type SortKey = 'member' | 'role' | 'overrides';
type ColumnKey = 'role' | 'overrides' | 'scope';
type OverrideValue = 'default' | 'grant' | 'revoke';

const COLUMN_LABELS: Record<ColumnKey, string> = {
  role: 'Role template',
  overrides: 'Access overrides',
  scope: 'Hotel scope',
};
const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = {
  role: true,
  overrides: true,
  scope: true,
};
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

/** Staff users for one selected property, using the existing staff and invitation endpoints. */
export function DashboardStaff({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const base = `/api/tenants/${tenantId}`;
  const [search, setSearch] = useState('');
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteTemplateId, setInviteTemplateId] = useState('');
  const [suspendTarget, setSuspendTarget] = useState<StaffMember | null>(null);
  const { columns, density, toggleColumn, toggleDensity } = useTablePreferences(
    'must.staff.table',
    DEFAULT_COLUMNS,
  );

  const staffQuery = useQuery({
    queryKey: ['dashboard', 'staff', tenantId, propertyId],
    queryFn: async () => {
      const [staffResponse, templatesResponse, usageResponse] = await Promise.all([
        fetch(`${base}/properties/${propertyId}/staff`, { credentials: 'include' }),
        fetch(`${base}/properties/${propertyId}/role-templates`, { credentials: 'include' }),
        fetch(`${base}/plan-usage`, { credentials: 'include' }),
      ]);
      if (!staffResponse.ok || !templatesResponse.ok || !usageResponse.ok)
        throw new Error('Unable to load staff management data.');
      const [staff, templates, usage] = (await Promise.all([
        staffResponse.json(),
        templatesResponse.json(),
        usageResponse.json(),
      ])) as [StaffMember[], StaffTemplate[], Usage];
      return {
        staff: staff.map((member) => ({ ...member, overrides: member.overrides ?? [] })),
        templates,
        usage,
      };
    },
  });
  const load = () => void staffQuery.refetch();
  const { staff = [], templates = [], usage } = staffQuery.data ?? {};
  const capped = usage ? usage.usage.staffSeats >= usage.plan.maxStaffSeats : false;
  const selectedInviteTemplate = inviteTemplateId || templates[0]?.id || '';

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
    setView('all');
    setInviteTemplateId('');
  }, [tenantId, propertyId]);

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${base}/staff-invitations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          assignments: [{ propertyId, roleTemplateId: selectedInviteTemplate }],
        }),
      });
      if (!response.ok) throw new Error('Unable to send invitation.');
    },
    onSuccess: () => {
      setInviteOpen(false);
      setEmail('');
      toast.success('Invitation sent.');
    },
    onError: () => toast.error('Unable to send invitation.'),
  });
  const assignMutation = useMutation({
    mutationFn: async ({ userId, roleTemplateId }: { userId: string; roleTemplateId: string }) => {
      const response = await fetch(`${base}/properties/${propertyId}/staff/${userId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleTemplateId }),
      });
      if (!response.ok) throw new Error('Unable to update staff role.');
    },
    onSuccess: () => {
      load();
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
    onSuccess: () => {
      load();
      toast.success('Capability override updated.');
    },
    onError: () => toast.error('Unable to update capability override.'),
  });

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const counts = useMemo(
    () => ({
      all: staff.length,
      'with-overrides': staff.filter((member) => member.overrides.length > 0).length,
      'without-overrides': staff.filter((member) => member.overrides.length === 0).length,
    }),
    [staff],
  );
  const filteredStaff = useMemo(
    () =>
      staff.filter((member) => {
        const matchesSearch =
          !normalizedSearch ||
          `${member.email} ${member.roleTemplateName}`
            .toLocaleLowerCase()
            .includes(normalizedSearch);
        const matchesView =
          view === 'all' ||
          (view === 'with-overrides' ? member.overrides.length > 0 : member.overrides.length === 0);
        return matchesSearch && matchesView;
      }),
    [normalizedSearch, staff, view],
  );
  const sortedStaff = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...filteredStaff].sort((left, right) => {
      const a =
        sort.key === 'member'
          ? left.email.toLocaleLowerCase()
          : sort.key === 'role'
            ? left.roleTemplateName.toLocaleLowerCase()
            : left.overrides.length;
      const b =
        sort.key === 'member'
          ? right.email.toLocaleLowerCase()
          : sort.key === 'role'
            ? right.roleTemplateName.toLocaleLowerCase()
            : right.overrides.length;
      return (a < b ? -1 : a > b ? 1 : 0) * factor;
    });
  }, [filteredStaff, sort]);
  const pageStaff = sortedStaff.slice((page - 1) * pageSize, page * pageSize);
  const selected = staff.find((member) => member.userId === selectedId) ?? null;
  const detailMember = detailId ? staff.find((member) => member.userId === detailId) : undefined;
  const tickedStaff = staff.filter((member) => ticked.includes(member.userId));
  const allTicked =
    pageStaff.length > 0 && pageStaff.every((member) => ticked.includes(member.userId));
  const someTicked = pageStaff.some((member) => ticked.includes(member.userId));
  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'member' || key === 'role' ? 'asc' : 'desc' },
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
      const pageIds = pageStaff.map((member) => member.userId);
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
  const requestSuspend = (member: StaffMember) => {
    setSelectedId(null);
    window.setTimeout(() => setSuspendTarget(member), 0);
  };

  if (staffQuery.isPending)
    return (
      <div className="space-y-5">
        <PageHeader title="Staff" description="Staff access for the selected hotel." />
        <ListSkeleton rows={6} />
      </div>
    );

  if (staffQuery.error)
    return (
      <div className="space-y-5">
        <PageHeader title="Staff" description="Staff access for the selected hotel." />
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
        <StaffDetail
          tenantId={tenantId}
          propertyId={propertyId}
          member={detailMember}
          templates={templates}
          roleChangePending={
            assignMutation.isPending && assignMutation.variables?.userId === detailMember.userId
          }
          pendingOverride={
            overrideMutation.isPending && overrideMutation.variables?.userId === detailMember.userId
              ? overrideMutation.variables.key
              : undefined
          }
          onChangeRole={(roleTemplateId) =>
            assignMutation.mutate({ userId: detailMember.userId, roleTemplateId })
          }
          onChangeOverride={(key, value) =>
            overrideMutation.mutate({ userId: detailMember.userId, key, value })
          }
          onSuspend={() => requestSuspend(detailMember)}
        />
        <SuspendStaffDialog target={suspendTarget} onClose={() => setSuspendTarget(null)} />
      </>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff"
        description="Manage the people assigned to this hotel and their role access."
        actions={
          <>
            <Button
              variant="outline"
              disabled
              title="Staff export is unavailable until the permission-gated, audited export is built (G21)."
            >
              Export CSV
            </Button>
            <Button
              onClick={() => setInviteOpen(true)}
              disabled={capped || templates.length === 0}
              title={capped ? 'The staff seat limit has been reached.' : undefined}
            >
              Invite staff
            </Button>
          </>
        }
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
              { id: 'with-overrides', label: 'With overrides', count: counts['with-overrides'] },
              {
                id: 'without-overrides',
                label: 'No overrides',
                count: counts['without-overrides'],
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
                      label: view === 'with-overrides' ? 'With overrides' : 'No overrides',
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
              description="Staff accounts appear here after an invitation is accepted and assigned to this hotel."
              action={
                <Button
                  size="sm"
                  onClick={() => setInviteOpen(true)}
                  disabled={capped || templates.length === 0}
                >
                  Invite staff
                </Button>
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
                      label="Role template"
                      active={sort.key === 'role'}
                      direction={sort.direction}
                      onSort={() => toggleSort('role')}
                    />
                  ) : null}
                  {columns.overrides ? (
                    <SortableTableHead
                      label="Overrides"
                      active={sort.key === 'overrides'}
                      direction={sort.direction}
                      onSort={() => toggleSort('overrides')}
                      align="right"
                    />
                  ) : null}
                  {columns.scope ? (
                    <TableHead className="px-2 py-2 normal-case tracking-normal">
                      Hotel scope
                    </TableHead>
                  ) : null}
                  <TableHead className="w-10 px-2 py-2 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageStaff.map((member) => {
                  const isTicked = ticked.includes(member.userId);
                  const template = templates.find(
                    (candidate) => candidate.id === member.roleTemplateId,
                  );
                  return (
                    <TableRow
                      key={member.userId}
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
                        setSelectedId(member.userId);
                      }}
                    >
                      <TableCell className="px-3 py-2">
                        <Checkbox
                          aria-label={`Select ${member.email}`}
                          checked={isTicked}
                          onCheckedChange={(value) => tick(member.userId, value === true)}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar>
                            <AvatarFallback>
                              {member.email.slice(0, 1).toLocaleUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setSelectedId(member.userId)}
                              aria-label={`Show details for ${member.email}`}
                              className="block max-w-full truncate bg-transparent p-0 text-left text-[12px] font-semibold text-foreground hover:underline"
                            >
                              {member.email}
                            </button>
                            <span className="block truncate text-[10px] text-muted-foreground group-data-[density=compact]:hidden">
                              {member.overrides.length > 0
                                ? `${member.overrides.length} access override${member.overrides.length === 1 ? '' : 's'}`
                                : 'No access overrides'}
                            </span>
                          </span>
                        </div>
                      </TableCell>
                      {columns.role ? (
                        <TableCell className="px-2 py-2">
                          <Badge variant="secondary">
                            {template?.name ?? member.roleTemplateName}
                          </Badge>
                        </TableCell>
                      ) : null}
                      {columns.overrides ? (
                        <TableCell className="px-2 py-2 text-right tabular-nums">
                          {member.overrides.length > 0 ? (
                            <Badge variant="warning">{member.overrides.length}</Badge>
                          ) : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </TableCell>
                      ) : null}
                      {columns.scope ? (
                        <TableCell className="px-2 py-2">
                          <span className="text-muted-foreground">This hotel</span>
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
                            <DropdownMenuItem onSelect={() => setSelectedId(member.userId)}>
                              Quick peek
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={staffHref(tenantId, propertyId, member.userId)}>
                                Open staff details
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void copyEmails([member])}>
                              Copy email
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => requestSuspend(member)}
                            >
                              Suspend access…
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

      <StaffSheet
        member={selected}
        template={
          selected
            ? templates.find((candidate) => candidate.id === selected.roleTemplateId)
            : undefined
        }
        tenantId={tenantId}
        propertyId={propertyId}
        onClose={() => setSelectedId(null)}
        onSuspend={() => {
          if (selected) requestSuspend(selected);
        }}
      />

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite staff member</DialogTitle>
            <DialogDescription>
              Send a single-use invitation for this hotel. The link expires after seven days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staff-invite-email">Work email</Label>
              <Input
                id="staff-invite-email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-invite-role">Role template</Label>
              <Select
                value={selectedInviteTemplate}
                onValueChange={setInviteTemplateId}
                disabled={templates.length === 0}
              >
                <SelectTrigger
                  id="staff-invite-role"
                  aria-label="Invite role template"
                  className="w-full"
                >
                  <SelectValue placeholder="Choose a role template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              The invitation accepts an email, role template and hotel assignment. Staff profile
              fields are not collected here.
            </p>
            {capped ? (
              <p role="alert" className="m-0 text-sm text-warning">
                This plan has reached its staff-seat limit.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteOpen(false)}
              disabled={inviteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={
                capped || !email.trim() || !selectedInviteTemplate || inviteMutation.isPending
              }
              loading={inviteMutation.isPending}
              onClick={() => inviteMutation.mutate()}
            >
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SuspendStaffDialog target={suspendTarget} onClose={() => setSuspendTarget(null)} />
    </div>
  );
}

function SuspendStaffDialog({
  target,
  onClose,
}: {
  target: StaffMember | null;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Suspend staff access"
      description={
        target ? (
          <>
            Suspend access for <strong>{target.email}</strong>?
          </>
        ) : null
      }
      confirmLabel="Suspension unavailable"
      destructive
      confirmDisabled
      onConfirm={async () => undefined}
    >
      <p className="m-0 rounded-md border border-warning/30 bg-warning-surface p-3 text-sm text-warning">
        The current staff API cannot suspend accounts or revoke sessions. Nothing will change. This
        action is disabled until that support is built (G157).
      </p>
    </ConfirmDialog>
  );
}
