import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/design/navigation' }));

import { navByRole, Pagination, Sidebar, visiblePages } from '../_ui/navigation';
import NavigationDesignPage from './page';

describe('Navigation design', () => {
  it('gives each role only its own destinations', () => {
    const labels = (role: keyof typeof navByRole) => navByRole[role].items.map((i) => i.label);
    expect(labels('admin')).toContain('Settings');
    expect(labels('staff')).not.toContain('Settings');
    expect(labels('finance')).toEqual(['Payments', 'Invoices', 'Reports', 'Reconciliation']);
    expect(labels('agent')).toContain('Manual Booking');
    expect(labels('readonly')).not.toContain('Manual Booking');
  });

  it('renders the sidebar with the current page marked and collapsed items labelled', () => {
    const open = renderToStaticMarkup(<Sidebar role="staff" current="calendar" />);
    expect(open).toContain('aria-current="page"');
    expect(open).toContain('Hotel Staff');
    const collapsed = renderToStaticMarkup(<Sidebar role="admin" collapsed />);
    expect(collapsed).toContain('aria-label="Bookings"');
    expect(collapsed).not.toContain('Reservation operations');
  });

  it('shows first, last and nearby pages with gaps', () => {
    expect(visiblePages(1, 4)).toEqual([1, 2, 3, 4]);
    expect(visiblePages(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(visiblePages(10, 10)).toEqual([1, 'gap', 9, 10]);
  });

  it('summarises the visible range in pagination', () => {
    const markup = renderToStaticMarkup(
      <Pagination page={10} pageCount={10} total={248} pageSize={25} />,
    );
    expect(markup).toContain('226–248 of 248');
  });

  it('renders the whole navigation page', () => {
    const markup = renderToStaticMarkup(<NavigationDesignPage />);
    for (const heading of ['Try it', 'Sidebar by role', 'Mobile drawer', 'Top header', 'Tabs']) {
      expect(markup).toContain(`>${heading}</h2>`);
    }
  });
});
