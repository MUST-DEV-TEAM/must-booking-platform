'use client';
import { useEffect, useState } from 'react';
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
import {
  RefundChoice,
  noRefund,
  refundAmountText,
  refundChoiceError,
  type RefundChoiceValue,
} from './refund-choice';
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
  initialRefundChoice,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canCancel: boolean;
  canRefund: boolean;
  initialRefundChoice?: RefundChoiceValue;
}) {
  const client = useQueryClient();
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [refundValue, setRefundValue] = useState<RefundChoiceValue>(noRefund);
  const [category, setCategory] = useState('guest_request'),
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
  const clockTerms = e?.policySource === 'CLOCK_PMS';
  const [clockTermsConfirmed, setClockTermsConfirmed] = useState(false);
  const paidBooking = {
    paidAmount: e?.paid ?? '0.00',
    refundedAmount: e?.alreadyRefunded ?? '0.00',
    total: { amount: e?.paid ?? '0.00', currency: e?.currency ?? 'EUR' },
  };
  useEffect(() => {
    setClockTermsConfirmed(false);
    if (open && e) {
      const remaining = (previewMinor(e.paid) ?? 0n) - (previewMinor(e.alreadyRefunded) ?? 0n);
      setRefundValue(
        initialRefundChoice ??
          (e.policySource === 'CLOCK_PMS' || (previewMinor(e.eligible) ?? 0n) === 0n
            ? noRefund
            : remaining === (previewMinor(e.eligible) ?? 0n)
              ? { ...noRefund, mode: 'full' }
              : { ...noRefund, mode: 'fixed', amount: e.eligible }),
      );
    }
  }, [open, bookingId, e?.bookingId]);
  const amount = refundAmountText(refundValue, paidBooking) ?? '0.00';
  const refundChoice =
    refundValue.mode === 'none' || (previewMinor(amount) ?? 0n) === 0n
      ? 'none'
      : !clockTerms && amount === e?.eligible
        ? 'eligible'
        : 'custom';
  const unpaidHold =
    e?.status === 'PAYMENT_PENDING' &&
    previewMinor(e.paid) === 0n &&
    !e.orderReference &&
    refundChoice === 'none';
  const approval = unpaidHold
    ? !canCancel
    : clockTerms
      ? !canCancel || !canRefund
      : !canCancel || !e?.isFree || refundChoice === 'custom';
  const invalidCustom = !!refundChoiceError(refundValue, paidBooking);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={approval ? 'Request cancellation' : 'Confirm cancellation'}
      description="Choose the refund and review the final outcome. This updates the reservation in MUST and its connected hotel system."
      confirmLabel={approval ? 'Submit request' : 'Cancel reservation'}
      reasonLabel="Details"
      reasonRequired
      destructive
      scrollBody
      contentClassName="sm:max-w-[600px]"
      confirmDisabled={
        !e ||
        query.isFetching ||
        query.isError ||
        invalidCustom ||
        (clockTerms && !clockTermsConfirmed)
      }
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
            refund: refundChoice,
            clockTermsConfirmed: clockTerms ? clockTermsConfirmed : undefined,
            customAmount: refundChoice === 'custom' ? amount : undefined,
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>div]:space-y-2">
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
      {e ? (
        <RefundChoice
          booking={paidBooking}
          value={refundValue}
          onChange={setRefundValue}
          policyNote={
            clockTerms
              ? 'Clock has not supplied machine-readable cancellation terms. An authorized reviewer must choose the refund.'
              : `Policy refund: ${e.eligible} ${e.currency}. Changes beyond the policy require review.`
          }
        />
      ) : null}
      {clockTerms ? (
        <Label className="flex items-start gap-3 rounded-lg border p-3 text-sm leading-relaxed [&_[role=switch]]:mt-0.5 [&_[role=switch]]:shrink-0">
          <Switch
            checked={clockTermsConfirmed}
            onCheckedChange={setClockTermsConfirmed}
            aria-label="Confirm Clock cancellation terms"
          />
          I confirm the refund decision for this Clock reservation.
        </Label>
      ) : null}
      <Label className="flex items-start gap-3 rounded-lg border p-3 text-sm leading-relaxed [&_[role=switch]]:mt-0.5 [&_[role=switch]]:shrink-0">
        <Switch
          checked={notify}
          onCheckedChange={setNotify}
          aria-label="Email guest cancellation"
        />{' '}
        Email the cancellation confirmation to the guest
      </Label>
    </ConfirmDialog>
  );
}
