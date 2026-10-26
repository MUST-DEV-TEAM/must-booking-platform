'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { ConfirmDialog } from '../../../../components/ui/confirm-dialog';
import { PageHeader } from '../../../../components/ui/page-header';
import { PermissionPanel } from '../../../../components/ui/permission-panel';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyPanel, ErrorPanel } from '../../../../components/ui/state-panel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import {
  ConsoleApiError,
  consoleGet,
  consolePost,
  consoleRequest,
  type SupportSession,
} from '../../../../lib/platform-api';
import { formatDateTime } from '../../../../lib/platform-format';
import { useConsoleSession } from '../console-frame';

const STATUS_TONE: Record<SupportSession['status'], 'success' | 'warning' | 'danger' | 'muted'> = {
  ACTIVE: 'success',
  PENDING_APPROVAL: 'warning',
  DENIED: 'danger',
  REVOKED: 'muted',
  EXPIRED: 'muted',
};
const STATUS_LABEL: Record<SupportSession['status'], string> = {
  ACTIVE: 'Active',
  PENDING_APPROVAL: 'Waiting for approval',
  DENIED: 'Denied',
  REVOKED: 'Ended',
  EXPIRED: 'Expired',
};

type Decision = { session: SupportSession; action: 'approve' | 'deny' };

export default function SupportAccessPage() {
  const { me, can } = useConsoleSession();
  const queryClient = useQueryClient();
  const allowed =
    can('platform.support.view_as') ||
    can('platform.support.act_as') ||
    can('platform.support.approve');
  const [decision, setDecision] = useState<Decision | null>(null);

  const query = useQuery({
    queryKey: ['platform-console', 'support-sessions'],
    queryFn: () => consoleGet<{ sessions: SupportSession[] }>('/support-sessions'),
    enabled: allowed,
    refetchInterval: 30_000,
  });
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['platform-console', 'support-sessions'] });

  const enter = useMutation({
    mutationFn: async (id: string) => {
      const result = await consoleRequest<{ dashboardPath: string }>(
        'POST',
        `/support-sessions/${id}/enter`,
        {},
        { idempotencyKey: null },
      );
      window.location.assign(result.dashboardPath);
    },
  });
  const end = useMutation({
    mutationFn: (id: string) => consolePost(`/support-sessions/${id}/revoke`, {}),
    onSuccess: refresh,
  });

  if (!allowed) return <PermissionPanel />;

  const sessions = query.data?.sessions ?? [];
  const toApprove = sessions.filter(
    (session) => session.status === 'PENDING_APPROVAL' && session.requestedBy.accountId !== me.id,
  );
  const mine = sessions.filter((session) => session.requestedBy.accountId === me.id);
  const actionError = enter.error ?? end.error;

  return (
    <>
      <PageHeader
        title="Support access"
        description="Time-limited access to a hotel. View-as is read-only; act-as needs approval and can only make limited changes."
      />
      {actionError instanceof ConsoleApiError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {actionError.message}
            {actionError.reference ? ` Reference: ${actionError.reference}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      {query.isLoading ? (
        <div className="space-y-3" role="status" aria-label="Loading sessions">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorPanel
          title="We couldn’t load support sessions"
          reference={
            query.error instanceof ConsoleApiError
              ? (query.error.reference ?? undefined)
              : undefined
          }
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          {can('platform.support.approve') ? (
            <Card>
              <CardHeader>
                <CardTitle>Waiting for your approval</CardTitle>
              </CardHeader>
              <CardContent>
                {toApprove.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">
                    No act-as requests are waiting.
                  </p>
                ) : (
                  <ul className="m-0 list-none divide-y p-0">
                    {toApprove.map((session) => (
                      <li
                        key={session.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="m-0 text-sm font-semibold">
                            {session.hotelName ?? 'Hotel'} ·{' '}
                            {session.requestedBy.name ?? session.requestedBy.email}
                          </p>
                          <p className="m-0 text-xs text-muted-foreground">
                            “{session.reason}” · lapses {formatDateTime(session.expiresAt)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDecision({ session, action: 'deny' })}
                          >
                            Deny
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setDecision({ session, action: 'approve' })}
                          >
                            Approve
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card className="gap-0 py-0">
            <CardHeader className="pt-5">
              <CardTitle>Your sessions</CardTitle>
              <p className="m-0 text-sm text-muted-foreground">
                Open a hotel from its page under Hotels to start one.
              </p>
            </CardHeader>
            {mine.length === 0 ? (
              <div className="p-4">
                <EmptyPanel
                  title="No support sessions yet"
                  description="Sessions you open will appear here."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hotel</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Until</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mine.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-semibold">
                        <a
                          href={`/platform/hotels/${session.tenantId}`}
                          className="text-foreground hover:underline"
                        >
                          {session.hotelName ?? session.tenantId}
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {session.kind === 'VIEW' ? 'View-as' : 'Act-as'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_TONE[session.status]}>
                          {STATUS_LABEL[session.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-72 truncate" title={session.reason}>
                        {session.reason}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(session.expiresAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {session.status === 'ACTIVE' ? (
                          <Button
                            size="sm"
                            onClick={() => enter.mutate(session.id)}
                            loading={enter.isPending}
                          >
                            Enter hotel
                          </Button>
                        ) : null}{' '}
                        {session.status === 'ACTIVE' || session.status === 'PENDING_APPROVAL' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => end.mutate(session.id)}
                          >
                            End
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}

      {decision ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDecision(null);
          }}
          title={`${decision.action === 'approve' ? 'Approve' : 'Deny'} act-as access?`}
          description={
            decision.action === 'approve'
              ? `${decision.session.requestedBy.email} will be able to make limited changes in ${decision.session.hotelName ?? 'the hotel'} for ${decision.session.durationMinutes} minutes. Every action is recorded and shown to the hotel owner.`
              : `${decision.session.requestedBy.email} will not get access.`
          }
          confirmLabel={decision.action === 'approve' ? 'Approve' : 'Deny'}
          cancelLabel="Cancel"
          destructive={decision.action === 'deny'}
          onConfirm={async () => {
            await consolePost(`/support-sessions/${decision.session.id}/${decision.action}`, {});
            refresh();
          }}
        />
      ) : null}
    </>
  );
}
