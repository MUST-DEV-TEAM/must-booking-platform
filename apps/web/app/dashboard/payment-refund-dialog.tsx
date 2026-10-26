'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { REFUND_REASONS, type RefundReason } from '@must/domain-contracts';
import { FormField } from '../../components/ui/form-field';
import { Combobox } from '../../components/ui/combobox';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
  noRefund,
  RefundChoice,
  refundChoiceError,
  refundRequestBody,
  type RefundChoiceValue,
} from './refund-choice';
import { CancellationDialog } from './cancellation-dialog';
import { SettingToggle } from '../../components/ui/setting-toggle';
import { guestName, type Reservation } from './reservations';

/**
 * The refund form, shared by the payments list and the single-payment page. It names the booking
 * being refunded so staff can be sure it is the right one, and previews the exact amount.
 */
export function RefundDialog({
  booking,
  base,
  onClose,
  onRefunded,
  canCancel = false,
}: {
  booking: Reservation;
  canCancel?: boolean;
  /** `/api/tenants/<tenant>/properties/<property>` */
  base: string;
  onClose: () => void;
  onRefunded: () => void;
}) {
  const queryClient = useQueryClient();
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const [cancelAlso, setCancelAlso] = useState(false);
  const scope = base.match(/\/tenants\/([^/]+)\/properties\/([^/]+)/);
  const [choice, setChoice] = useState<RefundChoiceValue>({ ...noRefund, mode: 'full' });

  const [reasonCode, setReasonCode] = useState<RefundReason | ''>('');
  // After the 24-hour window the server says whether this person may go on, and the refund is then made
  // only after they confirm it on purpose.
  const [lateAllowed, setLateAllowed] = useState(false);
  const [lateConfirmed, setLateConfirmed] = useState(false);
  const refund = async (note: string) => {
    const body = refundRequestBody(choice, booking);
    if (!reasonCode) throw new Error('Choose a refund reason.');
    if (!body) throw new Error('Choose how much to refund.');
    const payload = JSON.stringify({
      bookingId: booking.id,
      ...body,
      reasonCode,
      ...(lateConfirmed ? { lateRefund: true } : {}),
      ...(note.trim() ? { note: note.trim().slice(0, 500) } : {}),
    });
    if (attempt.current?.body !== payload)
      attempt.current = { body: payload, key: crypto.randomUUID() };
    const response = await fetch(`${base}/payments/refunds`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key },
      body: payload,
    });
    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      value?: { status?: string };
      error?: { message?: string; code?: string; lateAllowed?: boolean };
      message?: string;
    } | null;
    if (result?.error?.code === 'REFUND_WINDOW_CLOSED' && result.error.lateAllowed === true)
      setLateAllowed(true);
    if (!response.ok || result?.ok === false)
      throw new Error(result?.error?.message ?? result?.message ?? 'The refund could not be made.');
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    onRefunded();
    if (result?.value?.status === 'REFUND_PENDING')
      toast.info('Refund submitted. Provider confirmation is pending; review it before retrying.');
    else toast.success('Refund recorded.');
    onClose();
  };

  if (cancelAlso && scope)
    return (
      <CancellationDialog
        tenantId={scope[1]}
        propertyId={scope[2]}
        bookingId={booking.id}
        open
        canCancel={canCancel}
        canRefund
        initialRefundChoice={choice}
        onOpenChange={(open) => {
          if (!open) {
            onRefunded();
            onClose();
          }
        }}
      />
    );
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Refund payment"
      description={[booking.externalReference, guestName(booking)].filter(Boolean).join(' · ')}
      confirmLabel="Record refund"
      reasonLabel="Staff note (optional)"
      confirmDisabled={
        !reasonCode || !!refundChoiceError(choice, booking) || (lateAllowed && !lateConfirmed)
      }
      onConfirm={refund}
    >
      {canCancel && booking.status === 'CONFIRMED' && scope ? (
        <SettingToggle label="Also cancel booking" checked={cancelAlso} onChange={setCancelAlso} />
      ) : null}
      {lateAllowed ? (
        <SettingToggle
          label="Refund anyway: this was cancelled more than 24 hours ago"
          checked={lateConfirmed}
          onChange={setLateConfirmed}
        />
      ) : null}
      <FormField label="Refund reason">
        <Combobox
          label="Refund reason"
          value={reasonCode}
          onChange={(v) => setReasonCode(v as RefundReason)}
          options={[
            { value: '', label: 'Choose a reason' },
            ...REFUND_REASONS.map((value) => ({ value, label: value.replaceAll('_', ' ') })),
          ]}
        />
      </FormField>
      <RefundChoice
        booking={booking}
        heading="How much"
        allowNone={false}
        value={choice}
        onChange={setChoice}
      />
    </ConfirmDialog>
  );
}
