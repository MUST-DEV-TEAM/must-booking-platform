'use client';
import { SettingToggle } from '../../components/ui/setting-toggle';
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requestJson } from './cancellation-dialog';
import {
  CancellationPreview,
  type CancellationEvidence,
} from '../../components/ui/cancellation-preview';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
const priorityLabel = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
export type Approval = {
  selfApproved?: boolean;
  decisionNote?: string | null;
  executionActorId?: string | null;
  executionNote?: string | null;
  id: string;
  bookingId: string;
  version: number;
  requesterId: string | null;
  requesterName: string;
  status: string;
  createdAt: string;
  reasonCategory: string;
  priority: string;
  details: string;
  payload: {
    evidence: CancellationEvidence;
    refundAmount: string;
    input: { refund: string; notifyGuest: boolean };
  };
};
export function useApprovals(tenantId: string, propertyId: string, enabled = true) {
  return useQuery({
    queryKey: ['dashboard', tenantId, propertyId, 'approvals'],
    enabled,
    queryFn: () =>
      requestJson<{ items: Approval[]; count: number; decisions?: Approval[] }>(
        `/api/tenants/${tenantId}/properties/${propertyId}/requests`,
      ),
    refetchInterval: 30000,
  });
}
export function ApprovalPanel({
  request: q,
  onClose,
  onDecide,
}: {
  request: Approval | null;
  onClose: () => void;
  onDecide: (decision: string, note: string, clockTermsConfirmed?: boolean) => Promise<void>;
}) {
  const [note, setNote] = useState(q?.decisionNote ?? q?.executionNote ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [reviewedTerms, setReviewedTerms] = useState(false);
  const needsTerms = q?.requesterId === null && q?.payload.evidence.policySource === 'CLOCK_PMS';
  useEffect(() => {
    setReviewedTerms(false);
  }, [q?.id]);
  async function decide(decision: string) {
    setBusy(true);
    setError('');
    try {
      if (needsTerms) await onDecide(decision, note.trim(), reviewedTerms);
      else await onDecide(decision, note.trim());
      setNote('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={!!q}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setNote('');
          setError('');
          onClose();
        }
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Review cancellation request</SheetTitle>
          <SheetDescription>
            {q?.payload.evidence.reference} | {q ? priorityLabel(q.priority) : ''} priority
          </SheetDescription>
        </SheetHeader>
        {q ? (
          <div className="space-y-4 px-4 pb-6">
            {q.selfApproved ? <Badge variant="warning">Self-approved</Badge> : null}
            {q.status === 'Pending' && q.executionActorId ? (
              <p className="text-sm">
                Approval execution started. The original reviewer must resume with the recorded
                note. Check any provider sync problem before retrying.
              </p>
            ) : null}
            <p>
              Requested by {q.requesterName} | {new Date(q.createdAt).toLocaleString('en-GB')}
            </p>
            <p>
              {q.reasonCategory.replaceAll('_', ' ')}: {q.details}
            </p>
            <CancellationPreview
              evidence={q.payload.evidence}
              refundAmount={q.payload.refundAmount}
            />
            <p className="text-sm">
              Refund choice: {q.payload.input.refund}. Guest cancellation email:{' '}
              {q.payload.input.notifyGuest ? 'yes' : 'no'}.
            </p>
            <Button variant="link" asChild>
              <a
                href={`?${new URLSearchParams({ propertyId: typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('propertyId') ?? ''), section: 'reservations', reservation: q.bookingId })}`}
              >
                View reservation
              </a>
            </Button>
            <Label htmlFor="decision-note">Decision note (required)</Label>
            <Textarea
              id="decision-note"
              value={note}
              maxLength={1000}
              readOnly={q.status !== 'Pending'}
              onChange={(e) => setNote(e.target.value)}
            />
            {needsTerms && q.status === 'Pending' ? (
              <SettingToggle
                label="I reviewed the original cancellation terms and confirm this refund decision."
                checked={reviewedTerms}
                onChange={setReviewedTerms}
              />
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
            {q.status === 'Pending' ? (
              <div className="flex gap-2">
                <Button
                  disabled={busy || !note.trim() || (needsTerms && !reviewedTerms)}
                  onClick={() => void decide('Approved')}
                >
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || !note.trim() || !!q.executionActorId}
                  onClick={() => void decide('Rejected')}
                >
                  Reject
                </Button>
              </div>
            ) : (
              <p>{q.status}</p>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
export function ApprovalsQueue({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const query = useApprovals(tenantId, propertyId),
    client = useQueryClient();
  const [selected, setSelected] = useState<Approval | null>(null),
    [priority, setPriority] = useState('all'),
    [age, setAge] = useState('all');
  const items = (query.data?.items ?? []).filter(
    (q) =>
      (priority === 'all' || q.priority === priority) &&
      (age === 'all' || Date.now() - new Date(q.createdAt).getTime() >= Number(age) * 3600000),
  );
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger aria-label="Filter by priority" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['all', 'normal', 'high', 'urgent'].map((v) => (
              <SelectItem key={v} value={v}>
                {v === 'all' ? 'All priorities' : priorityLabel(v)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={age} onValueChange={setAge}>
          <SelectTrigger aria-label="Filter by age" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any age</SelectItem>
            <SelectItem value="24">Older than 24 hours</SelectItem>
            <SelectItem value="72">Older than 3 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {query.isPending ? (
        <ListSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorPanel onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyPanel
          title="No pending requests"
          description="Cancellation exceptions will appear here for review."
        />
      ) : (
        <div className="divide-y rounded-xl border">
          {items.map((q) => (
            <div key={q.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <strong>{q.payload.evidence.reference}</strong>{' '}
                <Badge variant="warning">{priorityLabel(q.priority)}</Badge>
                <p className="text-sm">
                  {q.requesterName} | {new Date(q.createdAt).toLocaleString('en-GB')}
                </p>
              </div>
              <Button variant="outline" onClick={() => setSelected(q)}>
                Review request
              </Button>
            </div>
          ))}
        </div>
      )}
      {query.data?.decisions?.length ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Recent decisions</h3>
          {query.data.decisions.map((q) => (
            <div
              key={q.id}
              className="flex items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div>
                {q.payload.evidence.reference} <Badge>{q.status}</Badge>{' '}
                {q.selfApproved ? <Badge variant="warning">Self-approved</Badge> : null}
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelected(q)}>
                View decision
              </Button>
            </div>
          ))}
        </section>
      ) : null}
      <ApprovalPanel
        key={selected?.id ?? 'closed'}
        request={selected}
        onClose={() => setSelected(null)}
        onDecide={async (decision, note, clockTermsConfirmed) => {
          if (!selected) return;
          const result = await requestJson<{
            outcome?: { refundOutcome?: { ok: boolean; message?: string } };
          }>(`/api/tenants/${tenantId}/properties/${propertyId}/requests/${selected.id}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decision,
              note,
              version: selected.version,
              ...(clockTermsConfirmed ? { clockTermsConfirmed: true } : {}),
            }),
          }).catch(async (error: unknown) => {
            await client.invalidateQueries({ queryKey: ['dashboard'] });
            throw error;
          });
          await client.invalidateQueries({ queryKey: ['dashboard'] });
          if (result.outcome?.refundOutcome?.ok === false)
            throw new Error(
              `Cancellation approved; refund needs attention: ${result.outcome.refundOutcome.message}`,
            );
        }}
      />
    </div>
  );
}
