'use client';

import { Mail } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailHeader } from '../../components/ui/detail-header';
import { DetailList } from '../../components/ui/detail-list';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { StatTile } from '../../components/ui/stat-tile';
import { TabBar } from '../../components/ui/tab-bar';
import { staffStats, type StaffMember, type StaffTemplate } from './staff-stats';

type OverrideValue = 'default' | 'grant' | 'revoke';
type StaffDetailTab = 'overview' | 'overrides';

export function staffListHref(tenantId: string, propertyId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=staff`;
}

export function staffHref(tenantId: string, propertyId: string, userId: string) {
  return `${staffListHref(tenantId, propertyId)}&staffUser=${encodeURIComponent(userId)}`;
}

/** A staff profile built from the property's existing membership, role and override data. */
export function StaffDetail({
  tenantId,
  propertyId,
  member,
  templates,
  roleChangePending,
  pendingOverride,
  onChangeRole,
  onChangeOverride,
  onSuspend,
}: {
  tenantId: string;
  propertyId: string;
  member: StaffMember;
  templates: StaffTemplate[];
  roleChangePending: boolean;
  pendingOverride?: string;
  onChangeRole: (roleTemplateId: string) => void;
  onChangeOverride: (key: string, value: OverrideValue) => void;
  onSuspend: () => void;
}) {
  const [tab, setTab] = useState<StaffDetailTab>('overview');
  const template = templates.find((candidate) => candidate.id === member.roleTemplateId);
  const stats = staffStats(member, template);

  return (
    <div className="space-y-5">
      <DetailHeader
        backHref={staffListHref(tenantId, propertyId)}
        backLabel="All staff"
        title={member.email}
        subtitle="Staff access for the selected hotel"
        badges={<Badge variant="success">Property member</Badge>}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={`mailto:${member.email}`}>
                <Mail aria-hidden="true" /> Email
              </a>
            </Button>
            <Button variant="destructive" size="sm" onClick={onSuspend}>
              Suspend access
            </Button>
          </>
        }
      />

      <div
        aria-label="Staff summary"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        role="group"
      >
        <StatTile
          label="Role template"
          size="sm"
          value={template?.name ?? member.roleTemplateName}
        />
        <StatTile
          label="Base capabilities"
          size="sm"
          value={stats.baseCapabilities}
          note="From the selected role template"
        />
        <StatTile
          label="Access overrides"
          size="sm"
          value={stats.overrides}
          note={`${stats.grantedOverrides} granted · ${stats.revokedOverrides} revoked`}
        />
        <StatTile
          label="Hotel scope"
          size="sm"
          value="This hotel"
          note="Current property assignment"
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
                { label: 'Role template', value: template?.name ?? member.roleTemplateName },
                { label: 'Hotel scope', value: 'Current property' },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-clip p-0">
          <div className="border-b px-4 pt-3">
            <TabBar
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'overrides', label: 'Access overrides', count: stats.overrides },
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
                  The current role template controls this staff member&apos;s baseline access.
                </p>
              </div>
              {templates.length > 0 ? (
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
              ) : (
                <p className="m-0 text-sm text-muted-foreground">
                  No role templates are available.
                </p>
              )}
              <p className="m-0 text-xs text-muted-foreground">
                A permission matrix and role-change impact preview are not available here.
              </p>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <div className="space-y-1">
                <h3 className="m-0 text-sm font-semibold">Overrides for this role</h3>
                <p className="m-0 text-sm text-muted-foreground">
                  Choose whether each capability follows the role template or has an explicit
                  override.
                </p>
              </div>
              {template?.capabilities.length ? (
                <div className="divide-y rounded-lg border">
                  {template.capabilities.map((capability) => {
                    const override = member.overrides.find(
                      (candidate) => candidate.capabilityKey === capability.key,
                    );
                    const value: OverrideValue = !override
                      ? 'default'
                      : override.granted
                        ? 'grant'
                        : 'revoke';
                    return (
                      <div
                        key={capability.key}
                        className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="m-0 text-sm font-semibold">
                            {capability.description || capability.key}
                          </p>
                          <p className="m-0 font-mono text-xs text-muted-foreground">
                            {capability.key}
                          </p>
                        </div>
                        <Select
                          value={value}
                          onValueChange={(next) =>
                            onChangeOverride(capability.key, next as OverrideValue)
                          }
                          disabled={pendingOverride === capability.key}
                        >
                          <SelectTrigger
                            aria-label={`${member.email} ${capability.key}`}
                            className="w-full sm:w-52"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Template default</SelectItem>
                            <SelectItem value="grant">Explicitly granted</SelectItem>
                            <SelectItem value="revoke">Explicitly revoked</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">
                  This role has no capabilities available to override.
                </p>
              )}
              <p className="m-0 text-xs text-muted-foreground">
                Reasons, approvers and expiry dates are not recorded for overrides yet.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
