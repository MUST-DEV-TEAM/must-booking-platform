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
      <dl className="m-0 grid grid-cols-2 gap-2 text-sm">
        {[
          ['Nights', String(p.nights)],
          ['Current total', amount(p.oldTotal)],
          ['New total', amount(p.newTotal)],
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
        No money is moved. Collect any balance or issue any refund separately.
      </p>
    </FormSection>
  );
}
