import { describe, expect, it } from 'vitest';

import { isChannelRelayEmail } from './channel-relay-email';

describe('isChannelRelayEmail', () => {
  it('recognises channel relay addresses', () => {
    expect(isChannelRelayEmail('x123@guest.booking.com')).toBe(true);
    expect(isChannelRelayEmail('ab@m.expediapartnercentral.com')).toBe(true);
    expect(isChannelRelayEmail('AB@Guest.Airbnb.com')).toBe(true);
  });

  it('accepts a guest’s own address', () => {
    expect(isChannelRelayEmail('ada@gmail.com')).toBe(false);
    expect(isChannelRelayEmail('ada@notbooking.com')).toBe(false);
    expect(isChannelRelayEmail(null)).toBe(false);
  });
});
