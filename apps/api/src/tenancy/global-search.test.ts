import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { cleanSearchText, likePattern } from './global-search.service';

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
