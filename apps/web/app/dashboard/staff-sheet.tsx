'use client';

import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DetailList, SectionLabel } from '../../components/ui/detail-list';
import { MultiSelect } from '../../components/ui/multi-select';
import {
  effectivePermissionItems,
  PermissionList,
  permissionMultiSelectOptions,
  type PermissionCatalogItem,
  type EffectivePermissionState,
} from '../../components/ui/permission-list';
import { QuickPeek } from '../../components/ui/quick-peek';
import { applyOverrideChanges, staffHref, type OverrideValue } from './staff-detail';
import type { StaffMember, StaffTemplate } from './staff-stats';

/** The quick look at a staff member opened from the directory. */
export function StaffSheet({
  member,
  template,
  tenantId,
  propertyId,
  catalog,
  myCapabilities,
  pendingOverride,
  statusPending = false,
  onClose,
  onChangeOverride,
  onChangeStatus,
}: {
  member: StaffMember | null;
  template?: StaffTemplate;
  tenantId: string;
  propertyId: string;
  catalog: PermissionCatalogItem[];
  myCapabilities: string[];
  pendingOverride?: string;
  statusPending?: boolean;
  onClose: () => void;
  onChangeOverride: (key: string, value: OverrideValue) => void;
  onChangeStatus: () => void;
}) {
  const effectiveQuery = useQuery({
    queryKey: ['dashboard', 'staff-effective-capabilities', tenantId, propertyId, member?.userId],
    enabled: member !== null,
    queryFn: async () => {
      if (!member) throw new Error('Choose a staff member first.');
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/staff/${member.userId}/effective-capabilities`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Effective permissions could not be loaded.');
      return (await response.json()) as EffectivePermissionState[];
    },
  });
  const effective = effectiveQuery.data ?? [];
  const sourcedPermissions = effectivePermissionItems(catalog, effective);
  const permissionOptions = permissionMultiSelectOptions(catalog, myCapabilities);
  const extraKeys = effective
    .filter((permission) => permission.source === 'extra')
    .map((permission) => permission.key);
  const deniedKeys = effective
    .filter((permission) => permission.source === 'denied')
    .map((permission) => permission.key);
  const onExtraChange = (next: string[]) =>
    applyOverrideChanges(extraKeys, next, 'grant', onChangeOverride);
  const onDeniedChange = (next: string[]) =>
    applyOverrideChanges(deniedKeys, next, 'revoke', onChangeOverride);
  const displayName = member
    ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
    : '';

  return (
    <QuickPeek
      open={member !== null}
      onClose={onClose}
      title={displayName}
      description={member?.email ?? 'Staff access for the selected hotel'}
      badges={
        member ? (
          <>
            <Badge variant={member.status === 'ACTIVE' ? 'success' : 'danger'}>
              {member.status === 'ACTIVE' ? 'Active' : 'Suspended'}
            </Badge>
            <Badge variant="secondary">{template?.name ?? member.roleTemplateName}</Badge>
          </>
        ) : null
      }
      actions={
        member ? (
          <>
            <Button size="sm" asChild className="flex-1">
              <a href={staffHref(tenantId, propertyId, member.userId)}>Open staff details</a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`mailto:${member.email}`}>
                <Mail aria-hidden="true" /> Email
              </a>
            </Button>
            <Button
              size="sm"
              variant={member.status === 'ACTIVE' ? 'destructive' : 'success'}
              disabled={!myCapabilities.includes('staff.suspend') || statusPending}
              title={
                myCapabilities.includes('staff.suspend')
                  ? undefined
                  : 'You do not have permission to manage staff status.'
              }
              onClick={onChangeStatus}
            >
              {member.status === 'ACTIVE' ? 'Suspend access' : 'Reactivate access'}
            </Button>
          </>
        ) : null
      }
    >
      {member ? (
        <>
          <DetailList
            className="rounded-lg border px-3"
            items={[
              { label: 'Email', value: member.email },
              { label: 'Role', value: template?.name ?? member.roleTemplateName },
              { label: 'Hotel', value: 'Selected hotel' },
              { label: 'Last active', value: formatStaffDate(member.lastActiveAt) },
              { label: 'Added by', value: member.createdByEmail ?? 'Not recorded' },
            ]}
          />
          <div className="space-y-2">
            <SectionLabel>Effective permissions</SectionLabel>
            {effectiveQuery.isPending ? (
              <p className="m-0 text-sm text-muted-foreground">Loading permissions…</p>
            ) : effectiveQuery.error ? (
              <p role="alert" className="m-0 text-sm text-destructive">
                {effectiveQuery.error.message}
              </p>
            ) : (
              <PermissionList
                permissions={sourcedPermissions}
                ariaLabel="Quick peek effective permissions"
              />
            )}
          </div>
          <div className="space-y-2">
            <SectionLabel>Extra permissions</SectionLabel>
            <MultiSelect
              options={permissionOptions}
              value={extraKeys}
              onChange={onExtraChange}
              placeholder="Choose extra permissions"
              disabled={pendingOverride !== undefined}
              label="Quick peek extra permissions"
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>Denied permissions</SectionLabel>
            <MultiSelect
              options={permissionOptions}
              value={deniedKeys}
              onChange={onDeniedChange}
              placeholder="Choose denied permissions"
              disabled={pendingOverride !== undefined}
              label="Quick peek denied permissions"
            />
          </div>
        </>
      ) : null}
    </QuickPeek>
  );
}

function formatStaffDate(value: string | null) {
  if (!value) return 'Not recorded';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? 'Not recorded'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
}
