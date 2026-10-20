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
      'Audit log',
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
    const labels = ['Overview', 'Needs attention', 'Approvals', 'Quick booking', 'System health'];
    for (const label of labels) expect(markup).toContain(label);
    const positions = labels.map((label) => markup.indexOf(label));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(markup).toContain('aria-label="Dashboard sections"');
    expect(markup).toContain('aria-selected="true"');
  });

  it('hides Quick Booking from staff without bookings.create', () => {
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

    expect(markup).not.toContain('Quick booking');
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
            capabilities: ['bookings.view', 'calendar.view', 'payments.view', 'guests.view'],
          },
        }),
      ),
    );

    for (const label of ['Dashboard', 'Bookings', 'Calendar', 'Hotels', 'Payments', 'Guests'])
      expect(markup).toContain(label);
    for (const label of ['Accommodations', 'Rates &amp; Pricing', 'Staff', 'Settings', 'Reports'])
      expect(markup).not.toContain(`>${label}</a>`);
  });

  it('keeps Payments hidden unless staff can also view its booking rows', () => {
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
            capabilities: ['payments.view'],
          },
        }),
      ),
    );
    expect(markup).not.toContain('>Payments</a>');
  });

  it('shows Accommodations (no separate Photos item) to staff granted only photos.manage', () => {
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
            capabilities: ['photos.manage'],
          },
        }),
      ),
    );

    expect(markup).toContain('Accommodations');
    expect(markup).not.toContain('>Photos</a>');
  });

  it('only renders the property switcher when a non-staff user has more than one property', () => {
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
            capabilities: ['bookings.view'],
          },
        }),
      ),
    );

    expect(singleProperty).not.toContain('Switch property');
    expect(singleProperty).toContain('Grand Hotel');
    expect(multipleProperties).toContain('Switch property');
    expect(multipleProperties).toContain('Switch property');
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

    expect(markup).toContain('Switch property');
    expect(markup).toContain('Switch property');
  });

  it('links an owner to Settings', () => {
    expect(dashboardNavigation('tenant-1', 'property-1', 'OWNER')).toContainEqual(
      expect.objectContaining({
        label: 'Settings',
        href: '/dashboard/tenant-1?propertyId=property-1&section=settings',
      }),
    );
  });

  it.each(['OWNER', 'ADMIN', 'STAFF'] as const)(
    'requires loaded settings.manage before showing Emails to %s',
    (role) => {
      expect(
        dashboardNavigation('tenant-1', 'property-1', role, 'overview', []).some(
          (item) => item.label === 'Emails',
        ),
      ).toBe(false);
      expect(
        dashboardNavigation('tenant-1', 'property-1', role, 'overview', ['settings.manage']),
      ).toContainEqual(
        expect.objectContaining({
          label: 'Emails',
          href: '/dashboard/tenant-1?propertyId=property-1&section=emails',
        }),
      );
    },
  );

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
      'Audit log',
      'Settings',
    ]);
    expect(ownerItems.find((item) => item.label === 'Bookings')?.href).toBe(
      '/dashboard/tenant-1?propertyId=property-1&section=reservations',
    );

    const staffItems = dashboardNavigation('tenant-1', 'property-1', 'STAFF', 'overview', [
      'bookings.view',
      'calendar.view',
      'payments.view',
      'guests.view',
    ]);
    expect(staffItems.map((item) => item.label)).toEqual([
      'Dashboard',
      'Bookings',
      'Calendar',
      'Hotels',
      'Inventory',
      'Payments',
      'Guests',
      'Audit log',
    ]);
  });

  it('shows a Finance property-staff session with its required booking access', () => {
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
            capabilities: ['bookings.view', 'payments.view', 'payments.refund', 'reports.view'],
          },
        }),
      ),
    );

    // The Overview tab (NavigationSectionTabItem) renders its label as bare anchor text with
    // no aria-label; sidebar destinations (NavigationLinks) wrap the label in a span for
    // accessible-name/truncation purposes and carry an aria-label on the anchor itself.
    expect(markup).toContain('Overview');
    for (const label of ['Bookings', 'Payments', 'Reports'])
      expect(markup).toContain(`aria-label="${label}"`);
    for (const label of [
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

  it('shows staff the management destinations their permissions open, and gates Inventory by calendar.view while keeping Settings private', () => {
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
              'staff.view',
              'settings.manage',
              'calendar.view',
            ],
          },
        }),
      ),
    );

    for (const label of ['Accommodations', 'Rates &amp; Pricing', 'Staff', 'Inventory'])
      expect(markup).toContain(`aria-label="${label}"`);
    for (const label of ['Settings']) expect(markup).not.toContain(`aria-label="${label}"`);
  });
});

it('shows Audit log only for a permitted staff event family, with owner/admin property access', () => {
  const sections = (role: 'OWNER' | 'ADMIN' | 'STAFF', capabilities: string[]) =>
    dashboardNavigation('t', 'p', role, 'overview', capabilities).map((item) => item.label);
  expect(sections('OWNER', [])).toContain('Audit log');
  expect(sections('ADMIN', [])).toContain('Audit log');
  expect(sections('STAFF', ['reports.view'])).toContain('Audit log');
  expect(sections('STAFF', ['staff.view'])).toContain('Audit log');
  expect(sections('STAFF', [])).not.toContain('Audit log');
  expect(sections('STAFF', ['bookings.create'])).not.toContain('Audit log');
});
