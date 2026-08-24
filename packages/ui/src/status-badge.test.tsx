// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusBadge, type StatusBadgeProps } from './status-badge';
import { statusTokenPairs, type StatusTokenPair } from './tokens';

const cases = [
  { domain: 'booking', state: 'pending' },
  { domain: 'booking', state: 'confirmed' },
  { domain: 'booking', state: 'cancelled' },
  { domain: 'booking', state: 'checked-in' },
  { domain: 'booking', state: 'checked-out' },
  { domain: 'booking', state: 'no-show' },
  { domain: 'payment', state: 'pending' },
  { domain: 'payment', state: 'paid' },
  { domain: 'payment', state: 'failed' },
  { domain: 'payment', state: 'refunded' },
  { domain: 'payment', state: 'unpaid' },
  { domain: 'room', state: 'available' },
  { domain: 'room', state: 'occupied' },
  { domain: 'room', state: 'cleaning' },
  { domain: 'room', state: 'maintenance' },
  { domain: 'room', state: 'reserved' },
  { domain: 'room', state: 'out-of-service' },
] as const satisfies ReadonlyArray<StatusBadgeProps>;

describe('StatusBadge', () => {
  it.each(cases)('uses both semantic tokens for $domain/$state', ({ domain, state }) => {
    const markup = renderToStaticMarkup(
      <StatusBadge {...({ domain, state } as StatusBadgeProps)} />,
    );
    const pair = (statusTokenPairs[domain] as Record<string, StatusTokenPair>)[state];

    expect(markup).toContain(`data-domain="${domain}"`);
    expect(markup).toContain(`data-state="${state}"`);
    expect(markup).toContain(`var(${pair.background})`);
    expect(markup).toContain(`var(${pair.foreground})`);
    expect(markup).toMatch(/>[^<]+<\/span>$/);
  });

  it('uses a supplied label without losing the semantic token pair', () => {
    const markup = renderToStaticMarkup(
      <StatusBadge domain="payment" label="Payment pending" state="pending" />,
    );

    expect(markup).toContain('>Payment pending</span>');
    expect(markup).toContain('var(--color-status-payment-pending-background)');
    expect(markup).toContain('var(--color-status-payment-pending-foreground)');
  });

  it('keeps the state type tied to its domain', () => {
    // @ts-expect-error A payment state cannot be used with a booking badge.
    const invalid: StatusBadgeProps = { domain: 'booking', state: 'paid' };
    expect(invalid).toBeDefined();
  });
});
