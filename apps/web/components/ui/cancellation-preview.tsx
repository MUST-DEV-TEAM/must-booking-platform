import { DetailList } from './detail-list';
import { Alert, AlertDescription, AlertTitle } from './alert';
export type CancellationEvidence = {
  bookingId: string;
  reference: string;
  version: number;
  status: string;
  ratePlan: string;
  timezone: string;
  cutoffAt: string | null;
  isFree: boolean;
  currency: string;
  paid: string;
  alreadyRefunded: string;
  penalty: string;
  eligible: string;
  method: string;
  legacyPolicy: boolean;
  policySource?: 'MUST' | 'CLOCK_PMS';
  previewHash: string;
};
export function previewMinor(value: string): bigint | null {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
/** Shared evidence in confirmation and review; all amounts come from the server preview. */
export function CancellationPreview({
  evidence: e,
  refundAmount,
}: {
  evidence: CancellationEvidence;
  refundAmount: string;
}) {
  const amount = (n: string) => `${n} ${e.currency}`;
  return (
    <div className="space-y-3">
      <Alert variant={e.isFree || e.policySource === 'CLOCK_PMS' ? 'info' : 'warning'}>
        <AlertTitle>
          {e.policySource === 'CLOCK_PMS'
            ? 'Review the cancellation refund'
            : e.isFree
              ? 'Within the free-cancellation policy'
              : 'Outside the free-cancellation policy'}
        </AlertTitle>
        <AlertDescription>
          Cancellation releases inventory and updates the provider record.{' '}
          {e.policySource === 'CLOCK_PMS'
            ? 'Clock has not supplied cancellation terms through the supported API. The refund below is your explicit decision.'
            : e.legacyPolicy
              ? 'Cancellation terms are taken from the current rate plan.'
              : ''}
        </AlertDescription>
      </Alert>
      <DetailList
        items={[
          { label: 'Rate plan', value: e.ratePlan },
          {
            label: `Free-cancellation deadline (${e.timezone})`,
            value:
              e.policySource === 'CLOCK_PMS'
                ? 'Not supplied by Clock'
                : e.cutoffAt
                  ? new Date(e.cutoffAt).toLocaleString('en-GB', { timeZone: e.timezone })
                  : 'No free cancellation',
          },
          { label: 'Paid', value: amount(e.paid) },
          {
            label: 'Penalty',
            value: e.policySource === 'CLOCK_PMS' ? 'Not supplied by Clock' : amount(e.penalty),
          },
          { label: 'Already refunded', value: amount(e.alreadyRefunded) },
          { label: 'Refund to issue', value: amount(refundAmount) },
          { label: 'Method', value: e.method },
          {
            label: 'State after',
            value:
              (previewMinor(refundAmount) ?? 0n) > 0n
                ? 'Cancelled; refund requested through the existing payment path'
                : 'Cancelled; no refund',
          },
        ]}
      />
    </div>
  );
}
