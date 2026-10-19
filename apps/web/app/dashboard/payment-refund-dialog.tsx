'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
}: {
  booking: Reservation;
  /** `/api/tenants/<tenant>/properties/<property>` */
  base: string;
  onClose: () => void;
  onRefunded: () => void;
}) {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<RefundChoiceValue>({ ...noRefund, mode: 'full' });

  const [reasonCode, setReasonCode] = useState<RefundReason | ''>('');
  const refund = async (note: string) => {
    const body = refundRequestBody(choice, booking);
    if (!reasonCode) throw new Error('Choose a refund reason.');
    if (!body) throw new Error('Choose how much to refund.');
    const response = await fetch(`${base}/payments/refunds`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        bookingId: booking.id,
        ...body,
        reasonCode,
        ...(note.trim() ? { note: note.trim().slice(0, 500) } : {}),
      }),
    });
    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: { message?: string };
      message?: string;
    } | null;
    if (!response.ok || result?.ok === false)
      throw new Error(result?.error?.message ?? result?.message ?? 'The refund could not be made.');
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    onRefunded();
    toast.success('Refund recorded.');
    onClose();
  };

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
      confirmDisabled={!reasonCode || !!refundChoiceError(choice, booking)}
      onConfirm={refund}
    >
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
