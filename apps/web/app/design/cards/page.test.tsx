import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { designNavigation } from '../design-shell';
import CardsPanelsPage from './page';

describe('Cards & panels design page', () => {
  it('adds a ready Cards & panels destination to the design preview sidebar', () => {
    const item = designNavigation.find((entry) => entry.href === '/design/cards');
    expect(item).toMatchObject({ href: '/design/cards', label: 'Cards & panels', ready: true });
    expect(item?.icon).toBeTruthy();
  });

  it('renders the operational panel patterns from the reference', () => {
    const markup = renderToStaticMarkup(<CardsPanelsPage />);

    for (const label of [
      'Cards &amp; panels',
      'Base panel',
      'KPI card',
      'Attention summary',
      'Entity card',
      'Booking card',
      'Payment card',
      'System health',
      'Alert panel',
      'Quick actions',
      'Provider connection',
      'Settings section',
      'State panels',
      'Design rules and guidelines',
      'Reservation synchronization',
      'Inventory source conflict',
      'Access restricted',
    ]) {
      expect(markup.toLowerCase()).toContain(label.toLowerCase());
    }

    expect(markup).toContain('Illustrative demo data only');
    expect(markup).toContain('do not change hotel or provider data');
  });
});
