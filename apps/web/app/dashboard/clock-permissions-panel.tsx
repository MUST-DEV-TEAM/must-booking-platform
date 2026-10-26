'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { CopyButton } from '../../components/ui/copy-button';

type Status = 'allowed' | 'missing' | 'error' | 'untested' | 'pending';
type Entry = {
  id: string;
  api: string;
  method: string;
  path: string;
  name: string;
  section: string;
  group: string;
  usedFor?: string;
  probeable: boolean;
  untestedReason?: string;
  status: Status;
  right?: string;
  expectedRight?: string;
  message?: string;
  checkedAt?: string;
};
export type ClockPermissionReport = {
  checkedAt: string | null;
  entries: Entry[];
  missingRights: string[];
};

const statusBadge = {
  allowed: { variant: 'success', label: 'Allowed' },
  missing: { variant: 'danger', label: 'Missing' },
  error: { variant: 'warning', label: 'Check failed' },
  untested: { variant: 'muted', label: 'Not tested' },
  pending: { variant: 'secondary', label: 'Not checked yet' },
} as const;

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'used', label: 'Used by MUST' },
  { key: 'missing', label: 'Missing' },
  { key: 'allowed', label: 'Allowed' },
  { key: 'untested', label: 'Not tested' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

const BATCH = 8;

/** The text an owner can paste into an email to Clock support. */
export function clockSupportText(report: ClockPermissionReport): string {
  if (report.missingRights.length === 0) return '';
  const used = report.entries.filter((entry) => entry.status === 'missing' && entry.usedFor);
  return [
    'Hello Clock support,',
    '',
    'Our integration API user is missing these rights. Please enable them:',
    ...report.missingRights.map((right) => `- ${right}`),
    ...(used.length > 0
      ? [
          '',
          'The ones our integration needs now or soon:',
          ...used.map((entry) => `- ${entry.right ?? entry.name}: ${entry.usedFor}`),
        ]
      : []),
    '',
    'Thank you.',
  ].join('\n');
}

function matches(entry: Entry, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'used') return Boolean(entry.usedFor);
  return entry.status === filter;
}

/** Which Clock rights the integration has, from a read-only check. Owners and admins only. */
export function ClockPermissionsPanel({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const queryClient = useQueryClient();
  const key = ['dashboard', 'clock-permissions', tenantId, propertyId];
  const [filter, setFilter] = useState<Filter>('all');
  const [running, setRunning] = useState<{
    checking: Set<string>;
    done: number;
    total: number;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Only a Clock-connected hotel has Clock rights to show.
  const connection = useQuery({
    queryKey: ['dashboard', 'clock-permissions-pms', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}/pms-connection-status`, { credentials: 'include' });
      if (!response.ok) return null;
      return ((await response.json()) as { provider?: string }).provider ?? null;
    },
  });
  const isClock = connection.data === 'CLOCK_PMS';

  const latest = useQuery({
    queryKey: key,
    enabled: isClock,
    retry: false,
    queryFn: async (): Promise<ClockPermissionReport | null> => {
      const response = await fetch(`${base}/clock-permissions`, { credentials: 'include' });
      // Staff without access simply do not see the panel.
      if (response.status === 403) return null;
      if (!response.ok) throw new Error('The Clock permissions could not be loaded.');
      return (await response.json()) as ClockPermissionReport;
    },
  });

  const runCheck = async (report: ClockPermissionReport) => {
    const ids = report.entries.filter((entry) => entry.probeable).map((entry) => entry.id);
    setFailure(null);
    for (let index = 0; index < ids.length; index += BATCH) {
      const batch = ids.slice(index, index + BATCH);
      setRunning({ checking: new Set(batch), done: index, total: ids.length });
      const response = await fetch(`${base}/clock-permissions/check`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: batch }),
      });
      const body = (await response.json().catch(() => null)) as
        (ClockPermissionReport & { message?: unknown }) | null;
      if (!response.ok || !body) {
        setFailure(
          typeof body?.message === 'string' ? body.message : 'The check could not be run.',
        );
        break;
      }
      queryClient.setQueryData(key, body);
    }
    setRunning(null);
  };

  if (!isClock || latest.data === null || latest.isPending) return null;
  const report = latest.data;
  const supportText = report ? clockSupportText(report) : '';
  const counts = { allowed: 0, missing: 0, error: 0, untested: 0, pending: 0 };
  for (const entry of report?.entries ?? []) counts[entry.status] += 1;
  const visible = (report?.entries ?? []).filter((entry) => matches(entry, filter));
  const groups = Array.from(new Set(visible.map((entry) => entry.group)));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">Clock permissions</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={!report || running !== null}
          onClick={() => report && void runCheck(report)}
        >
          {running ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck aria-hidden="true" />
          )}{' '}
          {running ? `Checking ${running.done} of ${running.total}…` : 'Check now'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="m-0 text-sm text-muted-foreground">
          Every Clock request we know of, and whether this connection is allowed to use it. The
          check only reads from Clock; anything that would create or change data is listed but never
          tested.
        </p>
        {failure || latest.error ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {failure ?? latest.error?.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">{counts.allowed} allowed</Badge>
          <Badge variant="danger">{counts.missing} missing</Badge>
          {counts.error > 0 ? <Badge variant="warning">{counts.error} check failed</Badge> : null}
          {counts.pending > 0 ? (
            <Badge variant="secondary">{counts.pending} not checked yet</Badge>
          ) : null}
          <Badge variant="muted">{counts.untested} not tested</Badge>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
          {FILTERS.map((option) => (
            <Button
              key={option.key}
              size="sm"
              variant={filter === option.key ? 'default' : 'outline'}
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {supportText ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
            <p className="m-0 text-sm">
              {report?.missingRights.length} missing right
              {report?.missingRights.length === 1 ? '' : 's'}. Copy a message for Clock support.
            </p>
            <CopyButton value={supportText} label="Copy message for Clock support" />
          </div>
        ) : null}
        {groups.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Nothing matches this filter.</p>
        ) : (
          groups.map((group) => {
            const rows = visible.filter((entry) => entry.group === group);
            return (
              <details key={group} open={filter !== 'all' || group === 'Rates and prices'}>
                <summary className="cursor-pointer text-sm font-semibold">
                  {group} <span className="font-normal text-muted-foreground">({rows.length})</span>
                </summary>
                <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {rows.map((entry) => {
                    const checking = running?.checking.has(entry.id) ?? false;
                    const badge = statusBadge[entry.status];
                    return (
                      <li
                        key={entry.id}
                        className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="m-0 text-sm font-semibold">
                            {entry.name}{' '}
                            {entry.usedFor ? <Badge variant="info">Used by MUST</Badge> : null}
                          </p>
                          <p className="m-0 break-all text-xs text-muted-foreground">
                            {entry.method} {entry.api}
                            {entry.path}
                          </p>
                          {entry.usedFor ? (
                            <p className="m-0 text-xs text-muted-foreground">{entry.usedFor}</p>
                          ) : null}
                          {entry.status === 'missing' ? (
                            <p className="m-0 text-xs text-destructive">
                              Missing right: {entry.right ?? entry.message ?? 'not named by Clock'}
                            </p>
                          ) : null}
                          {entry.status === 'error' ? (
                            <p className="m-0 text-xs text-muted-foreground">
                              Clock could not be reached for this one ({entry.message}). Press Check
                              now to try again.
                            </p>
                          ) : null}
                          {entry.status === 'untested' ? (
                            <p className="m-0 text-xs text-muted-foreground">
                              {entry.untestedReason}
                              {entry.expectedRight
                                ? ` Usual right name: ${entry.expectedRight}.`
                                : ''}
                            </p>
                          ) : null}
                        </div>
                        {checking ? (
                          <Badge variant="secondary">
                            <Loader2 className="animate-spin" aria-hidden="true" /> Checking…
                          </Badge>
                        ) : (
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })
        )}
        <p className="m-0 text-xs text-muted-foreground">
          {report?.checkedAt
            ? `Last checked ${new Date(report.checkedAt).toLocaleString()}.`
            : 'Not checked yet. Press “Check now”.'}
        </p>
      </CardContent>
    </Card>
  );
}
