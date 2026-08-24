import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardShell, dashboardNavigation } from './dashboard-shell';
import { DashboardQueryProvider } from './query-provider';

const user = {
  id: 'user-1',
  email: 'owner@example.test',
  emailVerified: true,
  isPlatformAdmin: false,
};

describe('Tenant dashboard shell', () => {
  it('renders all navigation destinations for an owner', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user,
            role: 'OWNER',
            properties: [{ id: 'property-1', name: 'Grand Hotel' }],
          },
        }),
      ),
    );

    const labels = [
      'Dashboard',
      'Bookings',
      'Calendar',
      'Hotels',
      'Inventory',
      'Payments',
      'Guests',
      'Accommodations',
      'Rates &amp; Pricing',
      'Staff',
      'Reports',
      'Settings',
    ];
    for (const label of labels) expect(markup).toContain(label);
    expect(labels.map((label) => markup.indexOf(label))).toEqual(
      [...labels.map((label) => markup.indexOf(label))].sort((left, right) => left - right),
    );
    expect(markup).toContain('owner@example.test');
    expect(markup).toContain('href="/dashboard"');
  });

  it('renders the dashboard tabs in designed order with linkable URLs', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user,
            role: 'OWNER',
            properties: [{ id: 'property-1', name: 'Grand Hotel' }],
          },
        }),
      ),
    );
    const labels = ['Overview', 'Needs Attention', 'Approvals', 'Quick Booking', 'System Health'];
    for (const label of labels) expect(markup).toContain(label);
    expect(markup.indexOf('Needs Attention')).toBeLessThan(markup.indexOf('Approvals'));
    expect(markup.indexOf('Approvals')).toBeLessThan(markup.indexOf('Quick Booking'));
    expect(markup.indexOf('Quick Booking')).toBeLessThan(markup.indexOf('System Health'));
    expect(markup).toContain('aria-label="Dashboard tabs"');
    expect(markup).toContain(
      'href="/dashboard/tenant-1?propertyId=property-1&amp;section=overview&amp;tab=overview"',
    );
    expect(markup).toContain(
      'href="/dashboard/tenant-1?propertyId=property-1&amp;section=overview&amp;tab=quick-booking"',
    );
    expect(markup).toContain('aria-current="page"');
  });

  it('hides Quick Booking from staff without bookings.manage', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user,
            role: 'STAFF',
            properties: [{ id: 'property-1', name: 'Grand Hotel' }],
            capabilities: ['calendar.view'],
          },
        }),
      ),
    );

    expect(markup).not.toContain('Quick Booking');
  });

  it('shows property-staff destinations granted by their capabilities', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user,
            role: 'STAFF',
            properties: [{ id: 'property-1', name: 'Grand Hotel' }],
            capabilities: ['bookings.manage', 'calendar.view', 'payments.refund', 'guests.manage'],
          },
        }),
      ),
    );

    for (const label of ['Dashboard', 'Bookings', 'Calendar', 'Hotels', 'Payments', 'Guests'])
      expect(markup).toContain(label);
    for (const label of ['Accommodations', 'Rates &amp; Pricing', 'Staff', 'Settings', 'Reports'])
      expect(markup).not.toContain(`>${label}</a>`);
  });

  it('renders the property switcher for every non-staff property scope', () => {
    const singleProperty = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user,
            role: 'OWNER',
            properties: [{ id: 'property-1', name: 'Grand Hotel' }],
          },
        }),
      ),
    );
    const multipleProperties = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user,
            role: 'OWNER',
            properties: [
              { id: 'property-1', name: 'Grand Hotel' },
              { id: 'property-2', name: 'Coast Hotel' },
            ],
          },
        }),
      ),
    );
    const staffWithMultipleProperties = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user,
            role: 'STAFF',
            properties: [
              { id: 'property-1', name: 'Grand Hotel' },
              { id: 'property-2', name: 'Coast Hotel' },
            ],
            capabilities: ['bookings.manage'],
          },
        }),
      ),
    );

    expect(singleProperty).toContain('Switch property');
    expect(singleProperty).toContain('Grand Hotel');
    expect(multipleProperties).toContain('Switch property');
    expect(multipleProperties).toContain('Coast Hotel');
    expect(multipleProperties).not.toContain('Main Dashboard');
    expect(staffWithMultipleProperties).not.toContain('Switch property');
  });

  it('uses the first property as the operational default for a multi-property tenant', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user,
            role: 'OWNER',
            properties: [
              { id: 'property-1', name: 'Grand Hotel' },
              { id: 'property-2', name: 'Coast Hotel' },
            ],
          },
        }),
      ),
    );

    expect(markup).toMatch(/<h2[^>]*>Grand Hotel<\/h2>/);
    expect(markup).toContain('value="property-1"');
  });

  it('links an owner to Settings', () => {
    expect(dashboardNavigation('tenant-1', 'property-1', 'OWNER')).toContainEqual(
      expect.objectContaining({
        label: 'Settings',
        href: '/dashboard/tenant-1?propertyId=property-1&section=settings',
      }),
    );
  });

  it('uses the designed navigation order and preserves the bookings route key', () => {
    const ownerItems = dashboardNavigation('tenant-1', 'property-1', 'OWNER');
    expect(ownerItems.map((item) => item.label)).toEqual([
      'Dashboard',
      'Bookings',
      'Calendar',
      'Hotels',
      'Inventory',
      'Payments',
      'Guests',
      'Accommodations',
      'Rates & Pricing',
      'Staff',
      'Reports',
      'Settings',
    ]);
    expect(ownerItems.find((item) => item.label === 'Bookings')?.href).toBe(
      '/dashboard/tenant-1?propertyId=property-1&section=reservations',
    );

    const staffItems = dashboardNavigation('tenant-1', 'property-1', 'STAFF', 'overview', [
      'bookings.manage',
      'calendar.view',
      'payments.refund',
      'guests.manage',
    ]);
    expect(staffItems.map((item) => item.label)).toEqual([
      'Dashboard',
      'Bookings',
      'Calendar',
      'Hotels',
      'Payments',
      'Guests',
    ]);
  });

  it('shows a Finance property-staff session only Overview, Payments, and Reports', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user: { ...user, email: 'finance@example.test' },
            role: 'STAFF',
            properties: [{ id: 'property-1', name: 'Grand Hotel' }],
            capabilities: ['payments.refund', 'reports.view'],
          },
        }),
      ),
    );

    // The Overview tab (NavigationSectionTabItem) renders its label as bare anchor text with
    // no aria-label; sidebar destinations (NavigationLinks) wrap the label in a span for
    // accessible-name/truncation purposes and carry an aria-label on the anchor itself.
    expect(markup).toContain('>Overview</a>');
    for (const label of ['Payments', 'Reports']) expect(markup).toContain(`aria-label="${label}"`);
    for (const label of [
      'Bookings',
      'Calendar',
      'Guests',
      'Inventory',
      'Accommodations',
      'Rates &amp; Pricing',
      'Staff',
      'Settings',
    ])
      expect(markup).not.toContain(`aria-label="${label}"`);
  });

  it('hides tenant-administration destinations from staff even if a misconfigured template grants their capability keys', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardShell, {
          tenantId: 'tenant-1',
          initialData: {
            user,
            role: 'STAFF',
            properties: [{ id: 'property-1', name: 'Grand Hotel' }],
            capabilities: [
              'accommodations.manage',
              'rates.manage',
              'staff.invite',
              'staff.manage_permissions',
              'settings.manage',
            ],
          },
        }),
      ),
    );

    for (const label of ['Accommodations', 'Rates &amp; Pricing', 'Inventory', 'Staff', 'Settings'])
      expect(markup).not.toContain(`>${label}</a>`);
  });
});
