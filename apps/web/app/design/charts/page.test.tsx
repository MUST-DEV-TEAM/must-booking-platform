import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/design/charts' }));

import { designNavigation } from '../design-shell';
import ChartsAnalyticsPage from './page';

describe('Charts & Analytics design page', () => {
  it('adds a ready sidebar destination after the final component preview', () => {
    const item = designNavigation.find((entry) => entry.href === '/design/charts');
    expect(item).toMatchObject({
      href: '/design/charts',
      label: 'Charts & Analytics',
      ready: true,
    });
    expect(item?.icon).toBeTruthy();
    expect(designNavigation.findIndex((entry) => entry.href === '/design/charts')).toBe(
      designNavigation.findIndex((entry) => entry.href === '/design/timeline') + 1,
    );
  });

  it('renders the analytics patterns and demo-only boundary', () => {
    const markup = renderToStaticMarkup(<ChartsAnalyticsPage />);
    for (const label of [
      'Charts &amp; Analytics',
      'Chart container',
      'Chart header &amp; controls',
      'Chart legend',
      'Booking volume trend',
      'Revenue &amp; deposits',
      'Booking status distribution',
      'Revenue performance',
      'Booking conversion',
      'Provider operations',
      'Payment &amp; refund distribution',
      'Chart tooltip',
      'Empty chart state',
      'Chart loading state',
      'Error / restricted state',
      'Analytics access is restricted',
    ])
      expect(markup.toLowerCase()).toContain(label.toLowerCase());

    expect(markup).toContain('Illustrative demo data only');
    expect(markup).toContain('do not read hotel or provider records');
    expect(markup).toContain('aria-label="Booking status breakdown"');
    expect(markup).toContain('aria-label="Provider operation outcomes"');
    expect(markup).toContain('aria-label="Date range"');
    expect(markup).toContain('aria-label="Booking status filter"');
    expect(markup).toContain('aria-label="Provider filter"');
    expect(markup).toContain('aria-label="Jan, Booking value: 38"');
    expect(markup).toContain('Download chart data');
    expect(markup).toContain('var(--must-color-chart-series-1)');
  });
});
