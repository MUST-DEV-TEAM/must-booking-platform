'use client';

import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailHeader } from '../../components/ui/detail-header';
import { DetailList } from '../../components/ui/detail-list';
import { MultiSelect } from '../../components/ui/multi-select';
import {
  effectivePermissionItems,
  PermissionList,
  permissionMultiSelectOptions,
  type EffectivePermissionState,
  type PermissionCatalogItem,
} from '../../components/ui/permission-list';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { StatTile } from '../../components/ui/stat-tile';
import { TabBar } from '../../components/ui/tab-bar';
import { type StaffMember, type StaffTemplate } from './staff-stats';

export type OverrideValue = 'default' | 'grant' | 'revoke';
type StaffDetailTab = 'overview' | 'permissions';

export function staffListHref(tenantId: string, propertyId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=staff`;
}

export function staffHref(tenantId: string, propertyId: string, userId: string) {
  return `${staffListHref(tenantId, propertyId)}&staffUser=${encodeURIComponent(userId)}`;
}

/** A staff profile assembled from the selected property's account, role, and effective access. */
export function StaffDetail({
  tenantId,
  propertyId,
  member,
  templates,
  catalog,
  myCapabilities,
  roleChangePending,
  pendingOverride,
  statusPending = false,
  onChangeRole,
  onChangeOverride,
  onChangeStatus,
}: {
  tenantId: string;
  propertyId: string;
  member: StaffMember;
  templates: StaffTemplate[];
  catalog: PermissionCatalogItem[];
  myCapabilities: string[];
  roleChangePending: boolean;
  pendingOverride?: string;
  statusPending?: boolean;
  onChangeRole: (roleTemplateId: string) => void;
  onChangeOverride: (key: string, value: OverrideValue) => void;
  onChangeStatus: () => void;
}) {
  const [tab, setTab] = useState<StaffDetailTab>('overview');
  const template = templates.find((candidate) => candidate.id === member.roleTemplateId);
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/staff/${member.userId}`;
  const effectiveQuery = useQuery({
    queryKey: ['dashboard', 'staff-effective-capabilities', tenantId, propertyId, member.userId],
    queryFn: async () => {
      const response = await fetch(`${base}/effective-capabilities`, { credentials: 'include' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
        throw new Error(
          typeof body?.message === 'string'
            ? body.message
            : 'Effective permissions could not be loaded.',
        );
      }
      return (await response.json()) as EffectivePermissionState[];
    },
  });
  const effective = effectiveQuery.data ?? [];
  const grantedKeys = effective.filter((permission) => permission.granted).map((item) => item.key);
  const extraKeys = effective
    .filter((permission) => permission.source === 'extra')
    .map((item) => item.key);
  const deniedKeys = effective
    .filter((permission) => permission.source === 'denied')
    .map((item) => item.key);
  const sourcedPermissions = effectivePermissionItems(catalog, effective);
  const permissionOptions = permissionMultiSelectOptions(catalog, myCapabilities);
  const canManagePermissions = myCapabilities.includes('staff.manage_permissions');
  const canManageRoles = myCapabilities.includes('staff.manage_roles');
  const onExtraChange = (nextKeys: string[]) =>
    applyOverrideChanges(extraKeys, nextKeys, 'grant', onChangeOverride);
  const onDeniedChange = (nextKeys: string[]) =>
    applyOverrideChanges(deniedKeys, nextKeys, 'revoke', onChangeOverride);
  const canChangeStatus = myCapabilities.includes('staff.suspend');
  const displayName = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email;

  return (
    <div className="space-y-5">
      <DetailHeader
        backHref={staffListHref(tenantId, propertyId)}
        backLabel="All staff"
        title={displayName}
        subtitle={member.email}
        badges={
          <>
            <Badge variant={member.status === 'ACTIVE' ? 'success' : 'danger'}>
              {member.status === 'ACTIVE' ? 'Active' : 'Suspended'}
            </Badge>
            <Badge variant="secondary">{template?.name ?? member.roleTemplateName}</Badge>
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={`mailto:${member.email}`}>
                <Mail aria-hidden="true" /> Email
              </a>
            </Button>
            {canChangeStatus ? (
              <Button
                variant={member.status === 'ACTIVE' ? 'destructive' : 'success'}
                size="sm"
                disabled={statusPending}
                onClick={onChangeStatus}
              >
                {member.status === 'ACTIVE' ? 'Suspend access' : 'Reactivate access'}
              </Button>
            ) : null}
          </>
        }
      />

      <div
        aria-label="Staff summary"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        role="group"
      >
        <StatTile label="Role" size="sm" value={template?.name ?? member.roleTemplateName} />
        <StatTile
          label="Status"
          size="sm"
          value={member.status === 'ACTIVE' ? 'Active' : 'Suspended'}
        />
        <StatTile
          label="Effective permissions"
          size="sm"
          value={effectiveQuery.isPending ? '…' : grantedKeys.length}
          note={`${deniedKeys.length} denied`}
        />
        <StatTile
          label="Extra permissions"
          size="sm"
          value={extraKeys.length}
          note="Granted directly to this staff member"
        />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact and identity</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: 'Email', value: member.email },
                { label: 'Role', value: template?.name ?? member.roleTemplateName },
                { label: 'Status', value: member.status === 'ACTIVE' ? 'Active' : 'Suspended' },
                { label: 'Hotel', value: 'Selected hotel' },
                { label: 'Last active', value: formatStaffDate(member.lastActiveAt) },
                { label: 'Added', value: formatStaffDate(member.createdAt) },
                { label: 'Added by', value: member.createdByEmail ?? 'Not recorded' },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-clip p-0">
          <div className="border-b px-4 pt-3">
            <TabBar
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'permissions', label: 'Permissions', count: effective.length },
              ]}
              current={tab}
              onSelect={(id) => setTab(id as StaffDetailTab)}
              label="Staff sections"
            />
          </div>
          {tab === 'overview' ? (
            <div className="space-y-4 p-4">
              <div className="space-y-1">
                <h3 className="m-0 text-sm font-semibold">Role assignment</h3>
                <p className="m-0 text-sm text-muted-foreground">
                  The selected role supplies baseline access. Extra permissions and denials are
                  shown in the Permissions tab.
                </p>
              </div>
              {canManageRoles && templates.length > 0 ? (
                <Select
                  value={member.roleTemplateId}
                  onValueChange={onChangeRole}
                  disabled={roleChangePending}
                >
                  <SelectTrigger aria-label={`Role for ${member.email}`} className="w-full sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : canManageRoles ? (
                <p className="m-0 text-sm text-muted-foreground">No roles are available.</p>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">
                  Current role: {template?.name ?? member.roleTemplateName}
                </p>
              )}
              <p className="m-0 text-xs text-muted-foreground">
                Role-change impact preview is not available yet (G158).
              </p>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {effectiveQuery.isPending ? (
                <ListSkeleton rows={5} />
              ) : effectiveQuery.error ? (
                <ErrorPanel
                  title="Effective permissions could not be loaded"
                  description={effectiveQuery.error.message}
                  onRetry={() => void effectiveQuery.refetch()}
                />
              ) : (
                <>
                  <section className="space-y-3">
                    <div className="space-y-1">
                      <h3 className="m-0 text-sm font-semibold">Effective permissions</h3>
                      <p className="m-0 text-xs text-muted-foreground">
                        Grants show whether access comes from the Role or an Extra grant. Explicit
                        denials are marked Denied.
                      </p>
                    </div>
                    <PermissionList
                      permissions={sourcedPermissions}
                      ariaLabel="Effective permissions"
                    />
                  </section>

                  {canManagePermissions ? (
                    <section className="space-y-3 border-t pt-4">
                      <div className="space-y-1">
                        <h3 className="m-0 text-sm font-semibold">Extra permissions</h3>
                        <p className="m-0 text-xs text-muted-foreground">
                          These grants add access to what the role already provides.
                        </p>
                      </div>
                      <MultiSelect
                        options={permissionOptions}
                        value={extraKeys}
                        onChange={onExtraChange}
                        placeholder="Choose extra permissions"
                        disabled={pendingOverride !== undefined}
                        label="Extra permissions"
                      />
                    </section>
                  ) : null}

                  {canManagePermissions ? (
                    <section className="space-y-3 border-t pt-4">
                      <div className="space-y-1">
                        <h3 className="m-0 text-sm font-semibold">Denied permissions</h3>
                        <p className="m-0 text-xs text-muted-foreground">
                          A denial overrides a permission granted by the role.
                        </p>
                      </div>
                      <MultiSelect
                        options={permissionOptions}
                        value={deniedKeys}
                        onChange={onDeniedChange}
                        placeholder="Choose denied permissions"
                        disabled={pendingOverride !== undefined}
                        label="Denied permissions"
                      />
                    </section>
                  ) : null}
                  <p className="m-0 text-xs text-muted-foreground">
                    Override reasons and expiry dates are not available yet (G156).
                  </p>
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Writes one added or removed permission override through the existing per-key operation. */
export function applyOverrideChanges(
  current: string[],
  next: string[],
  addedValue: 'grant' | 'revoke',
  onChange: (key: string, value: OverrideValue) => void,
) {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  for (const key of nextSet) if (!currentSet.has(key)) onChange(key, addedValue);
  for (const key of currentSet) if (!nextSet.has(key)) onChange(key, 'default');
}

function formatStaffDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? 'Not recorded'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
}
