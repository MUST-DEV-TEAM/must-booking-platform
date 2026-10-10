import { describe, expect, it } from 'vitest';

import { isReservedTestAddress } from '../src/mail/reserved-address';

describe('isReservedTestAddress', () => {
  it.each([
    'frontdesktesting@must.test',
    'a@example.test',
    'a@host.example',
    'a@bad.invalid',
    'a@box.localhost',
    'user@localhost',
    'user@test',
    'a@example.com',
    'A@Mail.Example.ORG',
    'Guest <guest@example.net>',
  ])('treats %s as unreachable', (address) => {
    expect(isReservedTestAddress(address)).toBe(true);
  });

  it.each(['owner@must.al', 'guest@gmail.com', 'a@testing.com', 'a@notexample.com', 'no-at-sign'])(
    'treats %s as a real address',
    (address) => {
      expect(isReservedTestAddress(address)).toBe(false);
    },
  );
});
