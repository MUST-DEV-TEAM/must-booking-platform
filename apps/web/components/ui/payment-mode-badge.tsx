import { Badge } from './badge';

export type PaymentMode = 'TEST' | 'LIVE';

/** Whether a payment account takes real money (Live) or is the provider's test account (Test). */
export function PaymentModeBadge({ mode }: { mode: PaymentMode }) {
  return mode === 'TEST' ? (
    <Badge variant="warning" title="Test account: payments are not real money">
      Test
    </Badge>
  ) : (
    <Badge variant="info" title="Live account: real payments">
      Live
    </Badge>
  );
}
