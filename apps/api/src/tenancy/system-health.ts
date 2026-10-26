/** Pure assembly of the hotel's live health signals from already-stored facts (no provider calls). */
export type HealthStatus = 'healthy' | 'attention' | 'unknown';
export type HealthSignal = {
  key: 'reservations' | 'pms' | 'payments' | 'emails';
  label: string;
  status: HealthStatus;
  headline: string;
  details: string[];
  /** The dashboard section that fixes or explains it. */
  action: { label: string; section: string } | null;
};

export type HealthFacts = {
  now: Date;
  pms: null | {
    provider: string;
    status: 'PENDING' | 'CONNECTED' | 'FAILED';
    lastTestResult: string | null;
    lastWebhookReceivedAt: Date | null;
  };
  openManualReviews: number;
  failedProviderOperations24h: number;
  bookingsNeedingAttention: number;
  gateways: { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
  paymentConnections: Array<{ provider: string; status: 'PENDING' | 'CONNECTED' | 'FAILED' }>;
  failedPayments24h: number;
  emailsFailed24h: number;
  emailsStuckQueued: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildHealthSignals(f: HealthFacts): HealthSignal[] {
  const reservations: HealthSignal =
    f.bookingsNeedingAttention > 0
      ? {
          key: 'reservations',
          label: 'Reservations',
          status: 'attention',
          headline: `${plural(f.bookingsNeedingAttention, 'reservation')} need attention`,
          details: ['Failed payments, provider rejections or manual review are waiting.'],
          action: { label: 'Open needs attention', section: 'overview&tab=needs-attention' },
        }
      : {
          key: 'reservations',
          label: 'Reservations',
          status: 'healthy',
          headline: 'No reservation needs attention',
          details: [],
          action: null,
        };

  let pms: HealthSignal;
  if (!f.pms) {
    pms = {
      key: 'pms',
      label: 'Property system',
      status: 'healthy',
      headline: 'Bookings are stored in MUST',
      details: ['No external property system is connected for this hotel.'],
      action: null,
    };
  } else {
    const details: string[] = [];
    const problems: string[] = [];
    if (f.pms.status === 'FAILED') problems.push('The connection test failed.');
    if (f.pms.status === 'PENDING') problems.push('The connection has not been verified yet.');
    if (f.pms.lastTestResult) details.push(`Last check: ${f.pms.lastTestResult}`);
    if (f.pms.lastWebhookReceivedAt) {
      const hours = Math.floor(
        (f.now.getTime() - f.pms.lastWebhookReceivedAt.getTime()) / 3_600_000,
      );
      details.push(
        `Last message from the provider: ${hours < 1 ? 'less than an hour' : `${hours} h`} ago.`,
      );
    } else {
      details.push('No message from the provider has been received yet.');
    }
    if (f.openManualReviews > 0)
      problems.push(`${plural(f.openManualReviews, 'booking')} waiting for a manual review.`);
    if (f.failedProviderOperations24h > 0)
      problems.push(
        `${plural(f.failedProviderOperations24h, 'provider request')} failed in the last 24 hours.`,
      );
    pms = {
      key: 'pms',
      label: 'Property system',
      status: problems.length ? 'attention' : f.pms.status === 'CONNECTED' ? 'healthy' : 'unknown',
      headline: problems.length ? problems[0]! : 'Connected and working',
      details: [...problems.slice(1), ...details],
      action: problems.length ? { label: 'Open settings', section: 'settings' } : null,
    };
  }

  const wanted = [f.gateways.stripe ? 'stripe' : null, f.gateways.pokpay ? 'pokpay' : null].filter(
    (value): value is string => value !== null,
  );
  const problemsPay: string[] = [];
  for (const provider of wanted) {
    const connection = f.paymentConnections.find((c) => c.provider.toLowerCase() === provider);
    if (!connection) problemsPay.push(`${provider} is switched on but not connected.`);
    else if (connection.status !== 'CONNECTED')
      problemsPay.push(`${provider} connection is ${connection.status.toLowerCase()}.`);
  }
  if (f.failedPayments24h > 0)
    problemsPay.push(`${plural(f.failedPayments24h, 'payment')} failed in the last 24 hours.`);
  const methods = [
    f.gateways.stripe ? 'card (Stripe)' : null,
    f.gateways.pokpay ? 'card (PokPay)' : null,
    f.gateways.payAtHotel ? 'pay at hotel' : null,
  ].filter(Boolean);
  const payments: HealthSignal = {
    key: 'payments',
    label: 'Payments',
    status: methods.length === 0 ? 'attention' : problemsPay.length ? 'attention' : 'healthy',
    headline:
      methods.length === 0
        ? 'No payment method is switched on'
        : problemsPay.length
          ? problemsPay[0]!
          : 'Payment methods are working',
    details: [
      ...(methods.length ? [`Active: ${methods.join(', ')}.`] : []),
      ...problemsPay.slice(1),
    ],
    action:
      methods.length === 0 || problemsPay.length
        ? { label: 'Open payment settings', section: 'settings' }
        : null,
  };

  const emailProblems: string[] = [];
  if (f.emailsFailed24h > 0)
    emailProblems.push(`${plural(f.emailsFailed24h, 'email')} failed in the last 24 hours.`);
  if (f.emailsStuckQueued > 0)
    emailProblems.push(
      `${plural(f.emailsStuckQueued, 'email')} waiting to send for over 30 minutes.`,
    );
  const emails: HealthSignal = {
    key: 'emails',
    label: 'Emails',
    status: emailProblems.length ? 'attention' : 'healthy',
    headline: emailProblems.length ? emailProblems[0]! : 'Emails are going out',
    details: emailProblems.slice(1),
    action: emailProblems.length ? { label: 'Open emails', section: 'emails' } : null,
  };

  return [reservations, pms, payments, emails];
}
