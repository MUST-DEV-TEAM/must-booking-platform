import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { cleanSearchText, likePattern, phoneDigits } from './global-search.service';

describe('global search text', () => {
  it('escapes LIKE wildcards so typed % and _ are plain characters', () => {
    expect(likePattern('50%_off')).toBe(String.raw`%50\%\_off%`);
    expect(likePattern(String.raw`a\b`)).toBe(String.raw`%a\\b%`);
  });

  it('trims, collapses spaces and rejects overlong text', () => {
    expect(cleanSearchText('  ana   arrival ')).toBe('ana arrival');
    expect(cleanSearchText(undefined)).toBe('');
    expect(() => cleanSearchText('x'.repeat(81))).toThrow(BadRequestException);
  });
});

describe('phone-like searches', () => {
  it('uses the digits of phone-like text only', () => {
    expect(phoneDigits('+355 69 12')).toBe('3556912');
    expect(phoneDigits('(069) 123-4567')).toBe('0691234567');
    expect(phoneDigits('691')).toBeNull();
    expect(phoneDigits('zelda 6912')).toBeNull();
  });
});
