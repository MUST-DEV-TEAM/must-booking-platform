import { describe, expect, it } from 'vitest';

import { checkIban, normaliseIban } from '@must/domain-contracts';

describe('IBAN check (G-48)', () => {
  it('accepts real-format IBANs, typed with spaces or small letters', () => {
    expect(checkIban('AL35 2021 1109 0000 0000 0123 4567')).toBeNull();
    expect(checkIban('gb82 west 1234 5698 7654 32')).toBeNull();
    expect(checkIban('DE89370400440532013000')).toBeNull();
  });

  it('refuses a typing mistake, a wrong shape and a non-text value', () => {
    expect(checkIban('AL35 2021 1109 0000 0000 0123 4568')).toMatch(/check digits/);
    expect(checkIban('12345')).toMatch(/valid IBAN/);
    expect(checkIban(null)).toBe('Enter the IBAN.');
  });

  it('keeps an IBAN without spaces and in capitals', () => {
    expect(normaliseIban('al35 2021 1109')).toBe('AL3520211109');
  });
});
