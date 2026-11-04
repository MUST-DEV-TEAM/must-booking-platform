import { describe, expect, it } from 'vitest';

import { canAccessSection, dashboardNavigation } from '../dashboard-shell';

const labels = (items: Array<{ label: string }>) => items.map((item) => item.label);
const nav = (role: 'OWNER' | 'ADMIN' | 'STAFF', capabilities: string[], dining: boolean) =>
  dashboardNavigation('t', 'p', role, 'overview', capabilities, {}, dining);

describe('Restaurants in the sidebar', () => {
  it('is hidden until a restaurant is activated', () => {
    expect(labels(nav('OWNER', [], false))).not.toContain('Restaurants');
  });

  it('sits between the day-to-day pages and the hotel setup pages', () => {
    const order = labels(nav('OWNER', [], true));
    expect(order.indexOf('Restaurants')).toBe(order.indexOf('Guests') + 1);
    expect(order.indexOf('Restaurants')).toBeLessThan(order.indexOf('Accommodations'));
  });

  it('opens inside the dashboard, like every other section', () => {
    const item = nav('OWNER', [], true).find((entry) => entry.label === 'Restaurants');
    expect(item?.href).toBe('/dashboard/t?propertyId=p&section=restaurants');
  });

  it('is marked current while its section is open', () => {
    const items = dashboardNavigation('t', 'p', 'OWNER', 'restaurants', [], {}, true);
    expect(items.find((entry) => entry.label === 'Restaurants')?.current).toBe(true);
  });

  it('is the only page for staff who work at the restaurant and have no hotel permissions', () => {
    const items = dashboardNavigation('t', 'p', 'STAFF', 'restaurants', [], {}, true, true);
    expect(labels(items)).toEqual(['Restaurants']);
  });

  it('adds Staff only for restaurant managers without granting hotel sections', () => {
    expect(
      labels(dashboardNavigation('t', 'p', 'STAFF', 'staff', [], {}, true, true, true)),
    ).toEqual(['Restaurants', 'Staff']);
    expect(canAccessSection('STAFF', [], 'staff')).toBe(false);
  });

  it('leaves the normal menu alone for staff who also have hotel permissions', () => {
    const items = dashboardNavigation(
      't',
      'p',
      'STAFF',
      'overview',
      ['bookings.view'],
      {},
      true,
      false,
    );
    expect(labels(items)).toEqual(expect.arrayContaining(['Dashboard', 'Bookings', 'Restaurants']));
  });

  it('is offered to staff without hotel permissions, whose access is set per restaurant', () => {
    expect(labels(nav('STAFF', [], true))).toContain('Restaurants');
    expect(canAccessSection('STAFF', [], 'restaurants')).toBe(true);
  });
});
