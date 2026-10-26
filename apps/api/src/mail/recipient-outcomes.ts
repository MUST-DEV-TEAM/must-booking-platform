import { envelopeAddresses, type RecipientEnvelope } from './recipient-envelope';

export type RecipientOutcome = 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED';
export type RecipientOutcomes = Record<string, RecipientOutcome>;
const events: Record<string, RecipientOutcome> = {
  'email.delivered': 'DELIVERED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
  'email.failed': 'FAILED',
  'email.suppressed': 'FAILED',
};
/** Only documented recipient-specific provider facts advance a grouped delivery. */
export function applyRecipientOutcome(
  envelope: RecipientEnvelope,
  previous: RecipientOutcomes,
  type: string,
  to: unknown,
) {
  const outcome = events[type];
  const addresses = envelopeAddresses(envelope);
  if (!outcome || !Array.isArray(to) || to.length !== 1 || typeof to[0] !== 'string') return null;
  const recipient = to[0].toLowerCase();
  if (!addresses.includes(recipient)) return null;
  const outcomes = { ...previous };
  const current = outcomes[recipient];
  if (!current || outcome === 'COMPLAINED' || (outcome === 'BOUNCED' && current !== 'COMPLAINED'))
    outcomes[recipient] = outcome;
  const values = addresses.map((address) => outcomes[address]);
  const status = values.includes('COMPLAINED')
    ? 'COMPLAINED'
    : values.includes('BOUNCED')
      ? 'BOUNCED'
      : values.includes('FAILED')
        ? 'FAILED'
        : values.every((value) => value === 'DELIVERED')
          ? 'DELIVERED'
          : 'SENT';
  return { recipient, outcomes, status };
}
