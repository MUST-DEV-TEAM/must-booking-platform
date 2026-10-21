'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
  CancellationPreview,
  previewMinor,
  type CancellationEvidence,
} from '../../components/ui/cancellation-preview';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...options });
  const body = await response.json();
  if (!response.ok || body?.ok === false)
    throw new Error(body?.error?.message ?? body?.message ?? 'The action could not be completed.');
  return body as T;
}
export function CancellationDialog({
  tenantId,
  propertyId,
  bookingId,
  open,
  onOpenChange,
  canCancel,
  canRefund,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canCancel: boolean;
  canRefund: boolean;
}) {
  const client = useQueryClient();
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [choice, setChoice] = useState('eligible'),
    [custom, setCustom] = useState(''),
    [category, setCategory] = useState('guest_request'),
    [priority, setPriority] = useState('normal'),
    [notify, setNotify] = useState(true);
  const query = useQuery({
    queryKey: ['dashboard', tenantId, propertyId, 'cancellation-preview', bookingId],
    enabled: open,
    queryFn: () =>
      requestJson<CancellationEvidence>(`${base}/bookings/${bookingId}/cancellation-preview`),
    staleTime: 0,
  });
  const e = query.data;
  const amount =
    choice === 'none' ? '0.00' : choice === 'custom' ? custom : (e?.eligible ?? '0.00');
  const approval = !canCancel || !e?.isFree || choice === 'custom';
  const customMinor = previewMinor(custom);
  const remainingMinor =
    (previewMinor(e?.paid ?? '0') ?? 0n) - (previewMinor(e?.alreadyRefunded ?? '0') ?? 0n);
  const invalidCustom =
    choice === 'custom' &&
    (customMinor === null || customMinor <= 0n || customMinor > remainingMinor);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={approval ? 'Request cancellation' : 'Confirm cancellation'}
      description="Review the policy and refund separately before confirming."
      confirmLabel={approval ? 'Submit request' : 'Cancel reservation'}
      reasonLabel="Details"
      reasonRequired
      destructive
      contentClassName="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
      confirmDisabled={!e || query.isFetching || query.isError || invalidCustom}
      onConfirm={async (details) => {
        if (!e) return;
        const result = await requestJson<{
          request?: { id: string };
          refundOutcome?: { ok: boolean; message?: string };
        }>(`${base}/bookings/${bookingId}/cancellation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: e.version,
            previewHash: e.previewHash,
            reasonCategory: category,
            priority,
            details,
            refund: choice,
            customAmount: choice === 'custom' ? custom : undefined,
            notifyGuest: notify,
          }),
        }).catch(async (error: unknown) => {
          await client.invalidateQueries({ queryKey: ['dashboard'] });
          throw error;
        });
        await client.invalidateQueries({ queryKey: ['dashboard'] });
        if (result.refundOutcome?.ok === false)
          throw new Error(`Cancelled; refund needs attention: ${result.refundOutcome.message}`);
      }}
    >
      {query.isPending ? (
        <ListSkeleton rows={2} />
      ) : query.isError ? (
        <ErrorPanel
          title="Could not load cancellation preview"
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : e ? (
        <CancellationPreview evidence={e} refundAmount={amount} />
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Reason category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label="Reason category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['guest_request', 'travel_change', 'medical', 'hotel_issue', 'other'].map((v) => (
                <SelectItem key={v} value={v}>
                  {v.replaceAll('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['normal', 'high', 'urgent'].map((v) => (
                <SelectItem key={v} value={v}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Refund decision</Label>
        <Select value={choice} onValueChange={setChoice}>
          <SelectTrigger aria-label="Refund decision">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="eligible">Full eligible refund (policy default)</SelectItem>
            <SelectItem value="none">No refund</SelectItem>
            {canRefund ? (
              <SelectItem value="custom">Custom amount (requires approval)</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>
      {choice === 'custom' ? (
        <div>
          <Label htmlFor="custom-refund">Custom refund</Label>
          <Input
            id="custom-refund"
            inputMode="decimal"
            value={custom}
            onChange={(v) => setCustom(v.target.value)}
          />
        </div>
      ) : null}
      <Label className="flex items-center gap-2">
        <Switch
          checked={notify}
          onCheckedChange={setNotify}
          aria-label="Email guest cancellation"
        />{' '}
        Send existing cancellation email to guest
      </Label>
    </ConfirmDialog>
  );
}
