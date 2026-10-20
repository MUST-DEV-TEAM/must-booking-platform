'use client';
import { useState } from 'react';
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
export type Approval = {
  executionActorId?: string | null;
  executionNote?: string | null;
  id: string;
  bookingId: string;
  version: number;
  requesterId: string;
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
      requestJson<{ items: Approval[]; count: number }>(
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
  onDecide: (decision: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(q?.executionNote ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function decide(decision: string) {
    setBusy(true);
    setError('');
    try {
      await onDecide(decision, note.trim());
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
            {q?.payload.evidence.reference} | {q?.priority} priority
          </SheetDescription>
        </SheetHeader>
        {q ? (
          <div className="space-y-4 px-4 pb-6">
            {q.executionActorId ? (
              <p className="text-sm">
                Approval execution started. The original reviewer must resume with the recorded
                note. Check any provider sync problem before retrying.
              </p>
            ) : null}
            <p>
              Requested by {q.requesterName} | {new Date(q.createdAt).toLocaleString()}
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
              onChange={(e) => setNote(e.target.value)}
            />
            {error ? <p role="alert">{error}</p> : null}
            <div className="flex gap-2">
              <Button disabled={busy || !note.trim()} onClick={() => void decide('Approved')}>
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
                {v === 'all' ? 'All priorities' : v}
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
                <Badge variant="warning">{q.priority}</Badge>
                <p className="text-sm">
                  {q.requesterName} | {new Date(q.createdAt).toLocaleString()}
                </p>
              </div>
              <Button variant="outline" onClick={() => setSelected(q)}>
                Review request
              </Button>
            </div>
          ))}
        </div>
      )}
      <ApprovalPanel
        key={selected?.id ?? 'closed'}
        request={selected}
        onClose={() => setSelected(null)}
        onDecide={async (decision, note) => {
          if (!selected) return;
          const result = await requestJson<{
            outcome?: { refundOutcome?: { ok: boolean; message?: string } };
          }>(`/api/tenants/${tenantId}/properties/${propertyId}/requests/${selected.id}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, note, version: selected.version }),
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
