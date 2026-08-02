import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TenantDetailView } from './page';

const tenant = {
  id: 'tenant-1',
  name: 'Acme Hotel',
  status: 'ACTIVE' as const,
  ownerEmail: 'owner@acme.test',
  createdAt: '2026-08-01T00:00:00.000Z',
  propertyCount: 3,
  stripeEnabled: true,
  pokpayEnabled: false,
  payAtHotelEnabled: true,
  stripeEnabledPropertyCount: 2,
  pokpayEnabledPropertyCount: 0,
  payAtHotelEnabledPropertyCount: 3,
};
const health = { stripe: { status: 'healthy' as const }, pokpay: { status: 'checking' as const } };

describe('Platform tenant detail page', () => {
  it('renders loading state', () =>
    expect(
      renderToStaticMarkup(
        createElement(TenantDetailView, { tenant: null, loading: true, notFound: false, health }),
      ),
    ).toContain('Loading tenant'));
  it('renders populated tenant details and disabled action placeholders', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantDetailView, { tenant, loading: false, notFound: false, health }),
    );
    expect(markup).toContain('Acme Hotel');
    expect(markup).toContain('owner@acme.test');
    expect(markup).toContain('Enabled on 2 of 3 properties');
    expect(markup).toContain('Suspend tenant');
    expect(markup).toContain('disabled');
  });
  it('renders not-found state', () =>
    expect(
      renderToStaticMarkup(
        createElement(TenantDetailView, { tenant: null, loading: false, notFound: true, health }),
      ),
    ).toContain('Tenant not found'));
});
