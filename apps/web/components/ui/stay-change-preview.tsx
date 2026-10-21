import { FormSection } from './form-section';
import { Alert, AlertDescription } from './alert';
export type StayChangePreviewData = {
  startsOn: string;
  endsOn: string;
  nights: number;
  available: boolean;
  oldTotal: string;
  newTotal: string | null;
  difference: string | null;
  currency: string;
  paid: string;
  refunded: string;
  balance: string | null;
  balanceState: string;
  policyNotes: string[];
  version: number;
  previewHash: string;
  outcome?: string;
  outcomeReason?: string;
  availableOutcomes?: string[];
  canRefund?: boolean;
  recordedTotal?: string | null;
  refundToIssue?: string;
};
export function StayChangePreview({ preview: p }: { preview: StayChangePreviewData }) {
  const amount = (value: string | null) =>
    value === null ? 'Unavailable' : `${p.currency} ${value}`;
  return (
    <FormSection
      title="Review date change"
      description={
        p.available ? 'The same accommodation is available.' : 'These dates cannot be confirmed.'
      }
    >
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {[
          ['Nights', String(p.nights)],
          ['Current total', amount(p.oldTotal)],
          ['New price', amount(p.newTotal)],
          ['Total after change', amount(p.recordedTotal ?? p.newTotal)],
          ['Refund to issue', amount(p.refundToIssue ?? '0.00')],
          ['Price change', amount(p.difference)],
          ['Already paid', amount(p.paid)],
          ['Already refunded', amount(p.refunded)],
          [
            p.balanceState === 'refund_due' ? 'Refund due' : 'Balance due',
            amount(p.balance?.replace(/^-/, '') ?? null),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {p.policyNotes.map((note, i) => (
        <Alert key={i} variant="warning">
          <AlertDescription>{note}</AlertDescription>
        </Alert>
      ))}
      <p className="m-0 text-sm text-muted-foreground">
        {p.outcome === 'refund'
          ? 'Confirming issues the refund shown above through the existing payment method. An unpaid decrease only lowers the total.'
          : p.outcome === 'charge'
            ? 'No card is charged automatically. Collect the balance using manual payment or the existing PokPay payment link.'
            : p.outcome === 'waive' || p.outcome === 'no_refund'
              ? 'The booking keeps its old agreed total. The price decision is recorded in its history.'
              : p.outcome === 'refund_due'
                ? 'No refund is issued now. Any overpayment remains as Refund due for a manager to settle.'
                : 'No money is moved.'}
      </p>
    </FormSection>
  );
}
