import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/design/tables' }));

import { designNavigation } from '../design-shell';
import DataTablesPage from './page';

describe('Data Tables design page', () => {
  it('adds a ready Data Tables destination to the design preview sidebar', () => {
    const item = designNavigation.find((entry) => entry.href === '/design/tables');
    expect(item).toMatchObject({ href: '/design/tables', label: 'Data Tables', ready: true });
    expect(item?.icon).toBeTruthy();
  });

  it('renders the booking table and the reference table patterns', () => {
    const markup = renderToStaticMarkup(<DataTablesPage />);

    for (const label of [
      'Data Tables',
      'Bookings table',
      'Booking table header',
      'Booking row states',
      'Sortable booking headers',
      'Expandable booking row',
      'Operational cell variants',
      'Permission-aware row actions',
      'Table pagination',
      'Role-scoped bulk actions',
      'Domain table examples',
      'Loading &amp; error states',
    ]) {
      expect(markup.toLowerCase()).toContain(label.toLowerCase());
    }

    expect(markup).toContain('aria-label="Search bookings"');
    expect(markup).toContain('MHB-1042');
    expect(markup).toContain('Clock PMS unavailable');
    expect(markup).toContain('Read-only Staff');
  });
});
