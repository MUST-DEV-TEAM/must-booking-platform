'use client';

import { Mail } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DetailList } from '../../components/ui/detail-list';
import { QuickPeek } from '../../components/ui/quick-peek';
import { SectionLabel } from '../../components/ui/detail-list';
import { staffHref } from './staff-detail';
import { staffStats, type StaffMember, type StaffTemplate } from './staff-stats';

/** The quick look at a staff member opened from the directory. */
export function StaffSheet({
  member,
  template,
  tenantId,
  propertyId,
  onClose,
  onSuspend,
}: {
  member: StaffMember | null;
  template?: StaffTemplate;
  tenantId: string;
  propertyId: string;
  onClose: () => void;
  onSuspend: () => void;
}) {
  const stats = member ? staffStats(member, template) : undefined;
  return (
    <QuickPeek
      open={member !== null}
      onClose={onClose}
      title={member?.email ?? ''}
      description="Staff access for the selected hotel"
      badges={
        member ? (
          <>
            <Badge variant="success">Property member</Badge>
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
            <Button size="sm" variant="destructive" onClick={onSuspend}>
              Suspend access
            </Button>
          </>
        ) : null
      }
    >
      {member && stats ? (
        <>
          <DetailList
            className="rounded-lg border px-3"
            items={[
              { label: 'Email', value: member.email },
              { label: 'Role template', value: template?.name ?? member.roleTemplateName },
              { label: 'Hotel scope', value: 'Current property' },
              { label: 'Base capabilities', value: stats.baseCapabilities },
              { label: 'Access overrides', value: stats.overrides },
            ]}
          />
          <div className="space-y-2">
            <SectionLabel>Account information</SectionLabel>
            <p className="m-0 text-sm text-muted-foreground">
              Last sign-in, device and account status are not available in the current staff data.
            </p>
          </div>
        </>
      ) : null}
    </QuickPeek>
  );
}
