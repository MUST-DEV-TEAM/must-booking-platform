import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardShell } from './dashboard-shell';

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

  it('hides management destinations for property staff', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardShell, {
        tenantId: 'tenant-1',
        initialData: {
          user,
          role: 'STAFF',
          properties: [{ id: 'property-1', name: 'Grand Hotel' }],
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

    expect(singleProperty).not.toContain('Switch property');
    expect(multipleProperties).toContain('Switch property');
    expect(multipleProperties).toContain('Coast Hotel');
  });
});
