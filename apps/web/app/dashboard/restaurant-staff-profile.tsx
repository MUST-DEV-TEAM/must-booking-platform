'use client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DetailHeader } from '../../components/ui/detail-header';
import { DetailList } from '../../components/ui/detail-list';
import { QuickPeek } from '../../components/ui/quick-peek';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { staffHref, staffListHref } from './staff-detail';
import type { StaffMember } from './staff-stats';
import { VENUE_ROLE_OPTIONS } from './venues/venue-roles';

export function RestaurantStaffProfile({
  member,
  tenantId,
  propertyId,
  full = false,
  canManage,
  pending,
  onClose,
  onChangeRole,
  onChangeStatus,
  onRemove,
}: {
  member: StaffMember;
  tenantId: string;
  propertyId: string;
  full?: boolean;
  canManage: boolean;
  pending: boolean;
  onClose: () => void;
  onChangeRole: (role: string) => void;
  onChangeStatus: () => void;
  onRemove: () => void;
}) {
  const restaurant = member.restaurant!;
  const title = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email;
  const badges = (
    <Badge variant={member.status === 'ACTIVE' ? 'success' : 'danger'}>
      {member.status === 'ACTIVE' ? 'Active' : 'Suspended'}
    </Badge>
  );
  const actions = (
    <>
      {!full ? (
        <Button asChild>
          <a href={staffHref(tenantId, propertyId, `${restaurant.venueId}/${member.userId}`)}>
            Open staff details
          </a>
        </Button>
      ) : null}
      {canManage ? (
        <>
          <Button variant="outline" disabled={pending} onClick={onChangeStatus}>
            {member.status === 'ACTIVE' ? 'Suspend access' : 'Reactivate access'}
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onRemove}>
            Remove access
          </Button>
        </>
      ) : null}
    </>
  );
  const fields = (
    <div className="space-y-4">
      <DetailList
        items={[
          { label: 'Email', value: member.email },
          { label: 'Restaurant', value: restaurant.venueName },
          { label: 'Role', value: member.roleTemplateName },
        ]}
      />
      <Select
        value={restaurant.role ?? 'HOST'}
        onValueChange={onChangeRole}
        disabled={!canManage || pending}
      >
        <SelectTrigger aria-label="Restaurant staff role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VENUE_ROLE_OPTIONS.map((role) => (
            <SelectItem key={role.value} value={role.value}>
              {role.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        {(restaurant.role ?? 'HOST') === 'MANAGER'
          ? 'Can manage this restaurant, its staff, settings and reservations.'
          : 'Can view this restaurant and manage its reservations.'}{' '}
        Hotel records require a separate hotel assignment.
      </p>
    </div>
  );
  return full ? (
    <div className="space-y-4">
      <DetailHeader
        title={title}
        subtitle={member.email}
        backHref={staffListHref(tenantId, propertyId)}
        backLabel="Back to staff"
        badges={badges}
        actions={actions}
      />
      <div className="rounded-xl border bg-card p-5">{fields}</div>
    </div>
  ) : (
    <QuickPeek
      open
      onClose={onClose}
      title={title}
      description={member.email}
      badges={badges}
      actions={actions}
    >
      {fields}
    </QuickPeek>
  );
}
