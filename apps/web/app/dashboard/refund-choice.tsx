'use client';

import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MoneyInput } from '../../components/ui/money-input';
import { SectionLabel } from '../../components/ui/detail-list';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { refundPreview, remainingRefundable } from './payment-status';

export type RefundMode = 'none' | 'full' | 'percentage' | 'fixed';
export type RefundChoiceValue = { mode: RefundMode; percentage: string; amount: string };

export const noRefund: RefundChoiceValue = { mode: 'none', percentage: '', amount: '' };

type Paid = { paidAmount: string; refundedAmount: string; total: { amount: string; currency: string } };

const formatMoney = (amount: string, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));

/** What would be refunded, as text like "220.00", or null when nothing valid is chosen. */
export function refundAmountText(choice: RefundChoiceValue, booking: Paid): string | null {
  if (choice.mode === 'none') return null;
  if (choice.mode === 'full') return remainingRefundable(booking).amount;
  if (choice.mode === 'percentage') return refundPreview(booking, 'percentage', '', choice.percentage);
  return refundPreview(booking, 'fixed', choice.amount, '');
}

/** The reason the choice cannot be used yet, or null when it is fine. */
export function refundChoiceError(choice: RefundChoiceValue, booking: Paid): string | null {
  const remaining = Number(remainingRefundable(booking).amount);
  if (choice.mode === 'percentage') {
    const value = Number(choice.percentage);
    if (!choice.percentage.trim() || !Number.isFinite(value) || value < 1 || value > 100)
      return 'Enter a percentage from 1 to 100.';
  }
  if (choice.mode === 'fixed') {
    const value = Number(choice.amount);
    if (!choice.amount.trim() || !Number.isFinite(value) || value <= 0) return 'Enter the amount to refund.';
    if (value > remaining) return `The most that can be refunded is ${remaining.toFixed(2)}.`;
  }
  return null;
}

/** The body for the refund request, or null when no refund was chosen. */
export function refundRequestBody(choice: RefundChoiceValue, booking: Paid) {
  const currency = booking.total.currency;
  if (choice.mode === 'none') return null;
  if (choice.mode === 'percentage') return { percentage: Number(choice.percentage) };
  const amount = refundAmountText(choice, booking);
  return amount ? { amount: { amount, currency } } : null;
}

/** The refund as the cancel request sends it: none, everything left, a percentage or an amount. */
export function refundPayload(choice: RefundChoiceValue, booking: Paid) {
  if (choice.mode === 'none') return { kind: 'none' as const };
  if (choice.mode === 'full') return { kind: 'full' as const };
  if (choice.mode === 'percentage') return { kind: 'percentage' as const, percentage: Number(choice.percentage) };
  return {
    kind: 'fixed' as const,
    amount: { amount: refundAmountText(choice, booking) ?? '0.00', currency: booking.total.currency },
  };
}

/**
 * Lets staff choose what happens to money already paid when a reservation is cancelled: nothing,
 * everything that is left, a percentage of it, or a fixed amount. Shows exactly how much will be
 * refunded. The refund is made through the same payment flow as the Payments page.
 */
export function RefundChoice({
  booking,
  value,
  onChange,
  policyNote,
}: {
  booking: Paid;
  value: RefundChoiceValue;
  onChange: (value: RefundChoiceValue) => void;
  /** One line about the cancellation policy, shown under the choices. */
  policyNote?: string;
}) {
  const currency = booking.total.currency;
  const remaining = remainingRefundable(booking).amount;
  const preview = refundAmountText(value, booking);
  const error = refundChoiceError(value, booking);

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <SectionLabel>Refund the guest</SectionLabel>
      <p className="m-0 text-xs text-muted-foreground">
        {formatMoney(remaining, currency)} was paid and can still be refunded.
      </p>
      <SegmentedControl<RefundMode>
        label="Refund amount"
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        options={[
          { value: 'none', label: 'No refund' },
          { value: 'full', label: 'Full refund' },
          { value: 'percentage', label: 'Percentage' },
          { value: 'fixed', label: 'Fixed amount' },
        ]}
      />

      {value.mode === 'percentage' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {[25, 50, 75].map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant={value.percentage === String(preset) ? 'default' : 'outline'}
                onClick={() => onChange({ ...value, percentage: String(preset) })}
              >
                {preset}%
              </Button>
            ))}
            <div className="w-28">
              <Input
                aria-label="Refund percentage"
                inputMode="numeric"
                placeholder="%"
                value={value.percentage}
                onChange={(event) =>
                  onChange({ ...value, percentage: event.target.value.replace(/\D/g, '').slice(0, 3) })
                }
              />
            </div>
          </div>
        </div>
      ) : null}

      {value.mode === 'fixed' ? (
        <FormField label="Amount to refund" className="max-w-48">
          <MoneyInput
            aria-label="Amount to refund"
            currency={currency}
            value={value.amount}
            onChange={(amount) => onChange({ ...value, amount })}
            invalid={!!error && value.amount !== ''}
          />
        </FormField>
      ) : null}

      {value.mode !== 'none' ? (
        error ? (
          <p role="alert" className="m-0 text-xs font-semibold text-destructive">
            {error}
          </p>
        ) : (
          <p className="m-0 text-sm">
            Refund: <strong>{preview ? formatMoney(preview, currency) : '—'}</strong>
            {preview && Number(preview) < Number(remaining)
              ? ` · ${formatMoney(String(Number(remaining) - Number(preview)), currency)} stays with the hotel`
              : ''}
          </p>
        )
      ) : (
        <p className="m-0 text-sm text-muted-foreground">
          The payment stays with the hotel. You can still refund it from Payments for 24 hours after cancelling.
        </p>
      )}
      {policyNote ? <p className="m-0 text-xs text-muted-foreground">{policyNote}</p> : null}
    </div>
  );
}
