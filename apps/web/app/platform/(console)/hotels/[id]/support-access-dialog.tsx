'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { FormField } from '../../../../../components/ui/form-field';
import { Textarea } from '../../../../../components/ui/input';
import { OptionCard } from '../../../../../components/ui/option-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import {
  ConsoleApiError,
  consoleGet,
  consolePost,
  consoleRequest,
  type HotelDetail,
  type SupportSession,
} from '../../../../../lib/platform-api';
import { formatDateTime } from '../../../../../lib/platform-format';
import { useConsoleSession } from '../../console-frame';

type Kind = 'VIEW' | 'ACT';

/** Opens a time-limited support session on this hotel: view-only, or limited changes after approval. */
export function SupportAccessDialog({
  hotel,
  open,
  onOpenChange,
}: {
  hotel: HotelDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useConsoleSession();
  const canView = can('platform.support.view_as');
  const canAct = can('platform.support.act_as');
  const [kind, setKind] = useState<Kind>(canView ? 'VIEW' : 'ACT');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [problem, setProblem] = useState<string | null>(null);
  const [requested, setRequested] = useState<SupportSession | null>(null);

  const existing = useQuery({
    queryKey: ['platform-console', 'support-sessions', hotel.id],
    queryFn: () =>
      consoleGet<{ sessions: SupportSession[] }>(`/support-sessions?tenantId=${hotel.id}`),
    enabled: open,
  });
  const mine = existing.data?.sessions.find(
    (session) => session.status === 'ACTIVE' || session.status === 'PENDING_APPROVAL',
  );

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

  const request = useMutation({
    mutationFn: () =>
      consolePost<SupportSession>('/support-sessions', {
        tenantId: hotel.id,
        kind,
        reason: reason.trim(),
        durationMinutes: Number(minutes),
      }),
    onSuccess: (session) => {
      if (session.status === 'ACTIVE') enter.mutate(session.id);
      else setRequested(session);
    },
  });

  const failure =
    request.error instanceof ConsoleApiError
      ? request.error
      : enter.error instanceof ConsoleApiError
        ? enter.error
        : null;
  const durations = kind === 'VIEW' ? ['30', '60', '120'] : ['30', '60'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open {hotel.name} as support</DialogTitle>
          <DialogDescription>
            Access is time-limited, tied to this hotel only, and every request is recorded. The
            hotel owner is told when a session starts.
          </DialogDescription>
        </DialogHeader>

        {requested ? (
          <Alert variant="info">
            <AlertTitle>Waiting for approval</AlertTitle>
            <AlertDescription>
              The hotel owner can approve in their dashboard, or another team member with approval
              rights can approve it under Support access. The request lapses in 30 minutes. Once
              approved, open it from <a href="/platform/support">Support access</a>.
            </AlertDescription>
          </Alert>
        ) : mine ? (
          <Alert variant={mine.status === 'ACTIVE' ? 'success' : 'info'}>
            <AlertTitle>
              You already have a {mine.kind === 'VIEW' ? 'view-as' : 'act-as'} session here
            </AlertTitle>
            <AlertDescription>
              {mine.status === 'ACTIVE'
                ? `It ends ${formatDateTime(mine.expiresAt)}.`
                : 'It is waiting for approval.'}
              {mine.status === 'ACTIVE' ? (
                <Button size="sm" onClick={() => enter.mutate(mine.id)} loading={enter.isPending}>
                  Enter the hotel
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            {failure ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {failure.message}
                  {failure.reference ? ` Reference: ${failure.reference}` : ''}
                </AlertDescription>
              </Alert>
            ) : null}
            <div role="radiogroup" aria-label="Kind of access" className="flex flex-col gap-3">
              <OptionCard
                icon={Eye}
                title="View as the hotel (read-only)"
                description="See what the hotel sees. Nothing can be changed. Starts straight away."
                disabled={!canView}
                aside={!canView ? 'Not in your role' : undefined}
                selected={kind === 'VIEW'}
                onSelect={() => {
                  setKind('VIEW');
                  setMinutes('60');
                }}
              />
              <OptionCard
                icon={ShieldAlert}
                title="Act on the hotel’s behalf"
                description="Limited changes such as bookings and calendar blocks. Never billing, staff, credentials, refunds or deletion. Needs approval."
                disabled={!canAct}
                aside={!canAct ? 'Not in your role' : undefined}
                selected={kind === 'ACT'}
                onSelect={() => {
                  setKind('ACT');
                  setMinutes('60');
                }}
              />
            </div>
            <FormField
              label="Why do you need access?"
              htmlFor="support-reason"
              required
              error={problem}
              hint="Shown to the hotel owner and kept in the audit log."
            >
              <Textarea
                id="support-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="For example: owner reported double bookings on 12 Nov"
              />
            </FormField>
            <FormField label="How long">
              <Select value={minutes} onValueChange={setMinutes}>
                <SelectTrigger aria-label="Session length" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {durations.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {requested || mine ? 'Close' : 'Cancel'}
          </Button>
          {!requested && !mine ? (
            <Button
              loading={request.isPending || enter.isPending}
              onClick={() => {
                if (reason.trim().length < 10) {
                  setProblem('Explain why in at least 10 characters.');
                  return;
                }
                setProblem(null);
                request.mutate();
              }}
            >
              {kind === 'VIEW' ? 'Start viewing' : 'Request approval'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
