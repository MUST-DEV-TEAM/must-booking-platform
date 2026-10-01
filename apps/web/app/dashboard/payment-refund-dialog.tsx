'use client';
import { Heading, Text } from '@must/ui';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { refundPreview, remainingRefundable } from './payment-status';
import { guestName, type Reservation } from './reservations';
import styles from './data-table.module.css';

const id = () => crypto.randomUUID();

/**
 * The refund form, shared by the payments list and the single-payment page. It
 * names the booking being refunded so staff can be sure it is the right one.
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
  const [mode, setMode] = useState<'fixed' | 'percentage'>('fixed');
  const [amount, setAmount] = useState('');
  const [percentage, setPercentage] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const maximum = remainingRefundable(booking);
  const preview = refundPreview(booking, mode, amount, percentage);

  const refund = useMutation({
    mutationFn: async (body: unknown) => {
      const response = await fetch(`${base}/payments/refunds`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id() },
        body: JSON.stringify(body),
      });
      const value = (await response.json()) as { ok: boolean; error?: { message?: string } };
      if (!value.ok) throw new Error(value.error?.message ?? 'Payment action failed.');
    },
    onSuccess: () => {
      onRefunded();
      onClose();
      toast.success('Refund recorded.');
    },
    onError: (error) => toast.error(error.message),
  });

  function submit() {
    const trimmedAmount = amount.trim();
    const trimmedPercentage = percentage.trim();
    if (mode === 'fixed' && trimmedAmount && !/^\d+(?:\.\d{1,2})?$/.test(trimmedAmount)) {
      setFormError('Enter a valid amount with no more than two decimal places.');
      return;
    }
    if (mode === 'percentage') {
      const numeric = Number(trimmedPercentage);
      if (!trimmedPercentage || !Number.isFinite(numeric) || numeric < 1 || numeric > 100) {
        setFormError('Enter a percentage between 1 and 100.');
        return;
      }
    }
    if (note.length > 500) {
      setFormError('The staff note must be 500 characters or fewer.');
      return;
    }
    refund.mutate({
      bookingId: booking.id,
      ...(mode === 'fixed' && trimmedAmount
        ? { amount: { amount: trimmedAmount, currency: booking.total.currency } }
        : {}),
      ...(mode === 'percentage' ? { percentage: Number(trimmedPercentage) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <section
        aria-labelledby="refund-dialog-title"
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        role="dialog"
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <Heading id="refund-dialog-title">Refund payment</Heading>
          <Text>{[booking.externalReference, guestName(booking)].filter(Boolean).join(' · ')}</Text>
          <Text tone="secondary">
            Remaining refundable balance: {maximum.amount} {booking.total.currency}
          </Text>
        </header>
        <div className={styles.dialogFields}>
          <label htmlFor="refund-type">Refund type</label>
          <select
            id="refund-type"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as 'fixed' | 'percentage');
              setFormError(null);
            }}
          >
            <option value="fixed">Fixed amount (€)</option>
            <option value="percentage">Percentage (%)</option>
          </select>
          {mode === 'fixed' ? (
            <label htmlFor="refund-amount">
              Amount ({booking.total.currency})
              <input
                id="refund-amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Leave blank for the remaining balance"
                value={amount}
              />
            </label>
          ) : (
            <label htmlFor="refund-percentage">
              Percentage of the remaining {maximum.amount} {booking.total.currency}
              <input
                id="refund-percentage"
                inputMode="decimal"
                max="100"
                min="1"
                onChange={(event) => setPercentage(event.target.value)}
                step="0.01"
                type="number"
                value={percentage}
              />
            </label>
          )}
          <Text>
            {preview
              ? `This will refund ${preview} ${booking.total.currency}`
              : 'Enter an amount or percentage to see what will be refunded'}
          </Text>
          <button
            className="must-button must-button--secondary"
            onClick={() => {
              setMode('fixed');
              setAmount(maximum.amount);
              setPercentage('');
              setFormError(null);
            }}
            type="button"
          >
            Use maximum ({maximum.amount} {booking.total.currency})
          </button>
          <label htmlFor="refund-note">
            Staff note (optional)
            <textarea
              id="refund-note"
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              value={note}
            />
          </label>
          {formError ? (
            <div className={styles.dialogError} role="alert">
              {formError}
            </div>
          ) : null}
        </div>
        <footer className={styles.dialogActions}>
          <button
            className="must-button must-button--secondary"
            disabled={refund.isPending}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="must-button must-button--danger"
            disabled={refund.isPending}
            onClick={submit}
            type="button"
          >
            {refund.isPending ? <Loader2 aria-hidden="true" size={16} /> : 'Record refund'}
          </button>
        </footer>
      </section>
    </div>
  );
}
