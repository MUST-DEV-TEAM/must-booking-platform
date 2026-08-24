import { describe, expect, it } from 'vitest';

import { breakpoints, DESIGN_TOKEN_VERSION, designTokens } from './tokens';

describe('responsive design-system contract', () => {
  it('exposes the four breakpoint tiers', () => {
    expect(breakpoints).toMatchObject({
      mobileMax: 767,
      tabletMin: 768,
      laptopMin: 1200,
      xlMin: 1440,
    });
  });

  it('registers every responsive CSS token', () => {
    expect(DESIGN_TOKEN_VERSION).toBe('1.4.0');
    const tokenNames = new Set(designTokens.map((token) => token.cssVariable));

    expect(
      [
        '--must-breakpoint-mobile-max',
        '--must-breakpoint-tablet-min',
        '--must-breakpoint-laptop-min',
        '--must-breakpoint-xl-min',
        '--must-responsive-page-padding',
        '--must-responsive-card-gap',
        '--must-responsive-heading-size',
        '--must-responsive-heading-line-height',
        '--must-responsive-body-size',
        '--must-responsive-body-line-height',
        '--must-responsive-touch-target',
        '--must-responsive-card-radius',
      ].every((token) => tokenNames.has(token as `--must-${string}`)),
    ).toBe(true);
  });
});
