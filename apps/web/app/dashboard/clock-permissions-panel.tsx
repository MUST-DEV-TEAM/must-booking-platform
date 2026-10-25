'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { CopyButton } from '../../components/ui/copy-button';

type PermissionResult = {
  endpoint: string;
  label: string;
  usedFor: string;
  status: 'allowed' | 'missing' | 'unknown';
  right?: string;
  message?: string;
};
export type ClockPermissionReport = {
  checkedAt: string | null;
  results: PermissionResult[];
  missingRights: string[];
};

const statusBadge = {
  allowed: { variant: 'success', label: 'Allowed' },
  missing: { variant: 'danger', label: 'Missing' },
  unknown: { variant: 'secondary', label: 'Not confirmed' },
} as const;

/** The text an owner can paste into an email to Clock support. */
export function clockSupportText(report: ClockPermissionReport): string {
  if (report.missingRights.length === 0) return '';
  return [
    'Hello Clock support,',
    '',
    'Our integration API user is missing these rights. Please enable them:',
    ...report.missingRights.map((right) => `- ${right}`),
    '',
    'Thank you.',
  ].join('\n');
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

  const check = useMutation({
    mutationFn: async (): Promise<ClockPermissionReport> => {
      const response = await fetch(`${base}/clock-permissions/check`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => null)) as
        (ClockPermissionReport & { message?: unknown }) | null;
      if (!response.ok || !body)
        throw new Error(
          typeof body?.message === 'string' ? body.message : 'The check could not be run.',
        );
      return body;
    },
    onSuccess: (report) => queryClient.setQueryData(key, report),
  });

  if (!isClock || latest.data === null || latest.isPending) return null;
  const report = latest.data;
  const supportText = report ? clockSupportText(report) : '';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">Clock permissions</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          <ShieldCheck aria-hidden="true" /> {check.isPending ? 'Checking…' : 'Check now'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="m-0 text-sm text-muted-foreground">
          Which parts of Clock this connection is allowed to use. The check only reads from Clock;
          it never creates or changes anything.
        </p>
        {check.error ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {check.error.message}
          </p>
        ) : null}
        {latest.error ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {latest.error.message}
          </p>
        ) : null}
        {!report?.checkedAt ? (
          <p className="m-0 text-sm">Not checked yet. Press “Check now”.</p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {report.results.map((result) => {
                const badge = statusBadge[result.status];
                return (
                  <li
                    key={result.endpoint}
                    className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold">{result.label}</p>
                      <p className="m-0 text-xs text-muted-foreground">{result.usedFor}</p>
                      {result.status === 'missing' && result.right ? (
                        <p className="m-0 text-xs text-destructive">
                          Missing right: {result.right}
                        </p>
                      ) : null}
                      {result.status === 'unknown' && result.message ? (
                        <p className="m-0 text-xs text-muted-foreground">{result.message}</p>
                      ) : null}
                    </div>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </li>
                );
              })}
            </ul>
            {supportText ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
                <p className="m-0 text-sm">
                  {report.missingRights.length} missing right
                  {report.missingRights.length === 1 ? '' : 's'}. Copy a message for Clock support.
                </p>
                <CopyButton value={supportText} label="Copy message for Clock support" />
              </div>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">No missing rights were found.</p>
            )}
            <p className="m-0 text-xs text-muted-foreground">
              Last checked {new Date(report.checkedAt).toLocaleString()}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
