import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FormsAndFiltersPage from './page';

describe('Forms and filters design page', () => {
  it('renders demo control states and booking filter patterns', () => {
    const markup = renderToStaticMarkup(<FormsAndFiltersPage />);

    for (const label of [
      'Forms &amp; filters',
      'Field states',
      'Guest name',
      'Internal notes',
      'Rate plans',
      'PMS auto-sync',
      'Stay date range',
      'Booking attachment',
      'Booking filters',
      'Filter chips',
      'Active filter summary',
      'Clear filters',
      'Guest occupancy',
      'Inventory mapping',
      'Pricing configuration',
      'Provider connection',
    ]) {
      expect(markup.toLowerCase()).toContain(label.toLowerCase());
    }
    expect(markup).toContain('MH-1042');
    expect(markup).not.toContain('EBR-');
    expect(markup).toContain('No connection or verification request is made.');
  });
});
