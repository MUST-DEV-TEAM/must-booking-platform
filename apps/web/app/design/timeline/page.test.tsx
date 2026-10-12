import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { designNavigation } from '../design-shell';
import TimelinePage from './page';

describe('Booking lifecycle timeline design page', () => {
  it('adds a ready timeline destination to the design preview sidebar', () => {
    const item = designNavigation.find((entry) => entry.href === '/design/timeline');
    expect(item).toMatchObject({
      href: '/design/timeline',
      label: 'Booking timeline',
      ready: true,
    });
    expect(item?.icon).toBeTruthy();
  });

  it('renders separate PokPay, Clock and booking activity with a safe recovery example', () => {
    const markup = renderToStaticMarkup(<TimelinePage />);

    for (const label of [
      'Booking lifecycle timeline',
      'Current state by domain',
      'PokPay payment verified',
      'Clock PMS+ reservation created',
      'Deposit posted to Clock folio',
      'Clock result is unconfirmed',
      'Run provider preflight before retry',
      'Sanitized diagnostics',
    ]) {
      expect(markup).toContain(label);
    }

    expect(markup).toContain('Independent states');
    expect(markup).toContain('role="note"');
    expect(markup).toContain('Preview operation · no provider request was made');
  });
});
