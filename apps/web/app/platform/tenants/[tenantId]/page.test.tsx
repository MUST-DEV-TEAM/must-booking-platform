// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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
      ).toString(),
    ).toContain('Loading tenant'));

  it('renders populated tenant details and disabled action placeholders', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantDetailView, {
        tenant,
        loading: false,
        notFound: false,
        health,
        onTransition: vi.fn(),
      }),
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
      ).toString(),
    ).toContain('Tenant not found'));

  it('calls suspend, shows pending, and surfaces a 409 conflict', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let resolveTransition!: () => void;
    const onTransition = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTransition = resolve;
        }),
    );
    await act(async () => {
      root.render(
        createElement(TenantDetailView, {
          tenant,
          loading: false,
          notFound: false,
          health,
          onTransition,
        }),
      );
    });
    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Suspend'),
    )!;
    await act(async () => {
      button.click();
    });
    expect(onTransition).toHaveBeenCalledWith('ACTIVE');
    expect(container.textContent).toContain('Updating');
    await act(async () => {
      resolveTransition();
    });
    onTransition.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    await act(async () => {
      button.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain('status changed elsewhere');
    root.unmount();
    container.remove();
  });
});
