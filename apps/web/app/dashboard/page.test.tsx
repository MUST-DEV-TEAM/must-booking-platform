import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardShell, dashboardNavigation } from './dashboard-shell';

const user = {
  id: 'user-1',
  email: 'owner@example.test',
  emailVerified: true,
  isPlatformAdmin: false,
};

describe('Tenant dashboard shell', () => {
  it('renders all navigation destinations for an owner', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardShell, {
        tenantId: 'tenant-1',
        initialData: {
          user,
          role: 'OWNER',
          properties: [{ id: 'property-1', name: 'Grand Hotel' }],
        },
      }),
    );

    const labels = [
      'Overview',
      'Reservations',
      'Calendar',
      'Accommodations',
      'Rates &amp; Pricing',
      'Payments',
      'Guests',
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

  it('shows property-staff destinations granted by their capabilities', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardShell, {
        tenantId: 'tenant-1',
        initialData: {
          user,
          role: 'STAFF',
          properties: [{ id: 'property-1', name: 'Grand Hotel' }],
          capabilities: ['bookings.manage', 'calendar.view', 'payments.refund', 'guests.manage'],
        },
      }),
    );

    for (const label of ['Overview', 'Reservations', 'Calendar', 'Payments', 'Guests'])
      expect(markup).toContain(label);
    for (const label of ['Accommodations', 'Rates &amp; Pricing', 'Staff', 'Settings', 'Reports'])
      expect(markup).not.toContain(`>${label}<`);
  });

  it('only renders the property switcher when multiple properties are available', () => {
    const singleProperty = renderToStaticMarkup(
      createElement(DashboardShell, {
        tenantId: 'tenant-1',
        initialData: {
          user,
          role: 'OWNER',
          properties: [{ id: 'property-1', name: 'Grand Hotel' }],
        },
      }),
    );
    const multipleProperties = renderToStaticMarkup(
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
    );
    const staffWithMultipleProperties = renderToStaticMarkup(
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
    );

    expect(singleProperty).not.toContain('Switch property');
    expect(multipleProperties).toContain('Switch property');
    expect(multipleProperties).toContain('Coast Hotel');
    expect(staffWithMultipleProperties).not.toContain('Switch property');
  });

  it('links an owner to Settings', () => {
    expect(dashboardNavigation('tenant-1', 'property-1', 'OWNER')).toContainEqual(
      expect.objectContaining({
        label: 'Settings',
        href: '/dashboard/tenant-1?propertyId=property-1&section=settings',
      }),
    );
  });

  it('shows a Finance property-staff session only Overview, Payments, and Reports', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardShell, {
        tenantId: 'tenant-1',
        initialData: {
          user: { ...user, email: 'finance@example.test' },
          role: 'STAFF',
          properties: [{ id: 'property-1', name: 'Grand Hotel' }],
          capabilities: ['payments.refund', 'reports.view'],
        },
      }),
    );

    for (const label of ['Overview', 'Payments', 'Reports']) expect(markup).toContain(`>${label}<`);
    for (const label of [
      'Reservations',
      'Calendar',
      'Guests',
      'Accommodations',
      'Rates &amp; Pricing',
      'Staff',
      'Settings',
    ])
      expect(markup).not.toContain(`>${label}<`);
  });

  it('hides tenant-administration destinations from staff even if a misconfigured template grants their capability keys', () => {
    const markup = renderToStaticMarkup(
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
    );

    for (const label of ['Accommodations', 'Rates &amp; Pricing', 'Staff', 'Settings'])
      expect(markup).not.toContain(`>${label}<`);
  });
});
