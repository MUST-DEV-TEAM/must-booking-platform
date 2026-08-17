// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '@must/ui';
import { loadTenantDetail, navigation, TenantDetailView } from './page';

const tenant = {
  id: 'tenant-1',
  name: 'Acme Hotel',
  status: 'ACTIVE' as const,
  ownerEmail: 'owner@acme.test',
  ownerUserId: 'owner-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  propertyCount: 3,
  stripeEnabled: true,
  pokpayEnabled: false,
  payAtHotelEnabled: true,
  stripeEnabledPropertyCount: 2,
  pokpayEnabledPropertyCount: 0,
  payAtHotelEnabledPropertyCount: 3,
  properties: [
    { id: 'property-1', name: 'Acme Beach House' },
    { id: 'property-2', name: 'Acme City Hotel' },
    { id: 'property-3', name: 'Acme Mountain Lodge' },
  ],
  connections: [
    {
      id: 'conn-1',
      kind: 'PMS' as const,
      provider: 'CLOCK_PMS' as const,
      name: 'Front Desk Clock',
      status: 'CONNECTED' as const,
      lastTestedAt: '2026-08-04T10:00:00.000Z',
      lastTestResult: 'OK',
    },
  ],
  manualReviewItems: [
    {
      id: 'review-1',
      category: 'UNKNOWN_RESULT',
      referenceType: 'booking',
      referenceId: 'booking-1',
      message: 'Booking creation timed out and could not be confirmed against Clock.',
      status: 'OPEN' as const,
      createdAt: '2026-08-04T11:00:00.000Z',
      resolvedAt: null,
    },
  ],
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
        onPasswordReset: vi.fn(),
      }),
    );
    expect(markup).toContain('Acme Hotel');
    expect(markup).toContain('owner@acme.test');
    expect(markup).toContain('Enabled on 2 of 3 properties');
    expect(markup).toContain('Suspend tenant');
    expect(markup).toContain('Front Desk Clock');
    expect(markup).toContain('Clock PMS');
    expect(markup).toContain('connected');
  });

  it('shows an empty state when the tenant has no integration connections', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantDetailView, {
        tenant: { ...tenant, connections: [] },
        loading: false,
        notFound: false,
        health,
        onTransition: vi.fn(),
        onPasswordReset: vi.fn(),
      }),
    );
    expect(markup).toContain('No integration connections configured.');
  });

  it('shows an empty state when there is nothing to review', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantDetailView, {
        tenant: { ...tenant, manualReviewItems: [] },
        loading: false,
        notFound: false,
        health,
        onTransition: vi.fn(),
        onPasswordReset: vi.fn(),
      }),
    );
    expect(markup).toContain('Nothing needs review.');
  });

  it('keeps tenant details visible and marks provider health unavailable after a forced health error', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tenant), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const result = await loadTenantDetail('tenant-1', request);

    expect(result).toMatchObject({
      tenant: { id: 'tenant-1' },
      notFound: false,
      health: { stripe: { status: 'unavailable' }, pokpay: { status: 'unavailable' } },
    });
    expect(
      renderToStaticMarkup(
        createElement(TenantDetailView, {
          tenant: result.tenant,
          loading: false,
          notFound: false,
          health: result.health,
        }),
      ),
    ).toContain('health: unavailable');
  });

  it('lists an open manual review item and resolves it on click', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let resolveClick!: () => void;
    const onResolveManualReview = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClick = resolve;
        }),
    );
    await act(async () => {
      root.render(
        createElement(TenantDetailView, {
          tenant,
          loading: false,
          notFound: false,
          health,
          onResolveManualReview,
        }),
      );
    });
    expect(container.textContent).toContain('Unknown result');
    expect(container.textContent).toContain('booking booking-1');
    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Mark reviewed'),
    )!;
    await act(async () => {
      button.click();
    });
    expect(onResolveManualReview).toHaveBeenCalledWith('review-1');
    expect(container.textContent).toContain('Marking…');
    await act(async () => {
      resolveClick();
    });
    root.unmount();
    container.remove();
  });

  it('renders not-found state', () =>
    expect(
      renderToStaticMarkup(
        createElement(TenantDetailView, { tenant: null, loading: false, notFound: true, health }),
      ).toString(),
    ).toContain('Tenant not found'));

  it('renders the complete platform navigation with the signed-in email', () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        navigation,
        title: 'Platform operations',
        userEmail: 'admin@example.com',
        children: null,
      }),
    );
    expect(markup).toContain('Overview');
    expect(markup).toContain('Tenants');
    expect(markup).toContain('Audit Log');
    expect(markup).toContain('<svg');
    expect(markup).toContain('admin@example.com');
    expect(markup).not.toContain('Signed-in user');
  });

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

  it('triggers the owner reset and disables it when no owner exists', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let resolveReset!: () => void;
    const onPasswordReset = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );
    await act(async () => {
      root.render(
        createElement(TenantDetailView, {
          tenant,
          loading: false,
          notFound: false,
          health,
          onTransition: vi.fn(),
          onPasswordReset,
        }),
      );
    });
    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Reset owner'),
    )!;
    await act(async () => {
      button.click();
    });
    expect(onPasswordReset).toHaveBeenCalledWith('owner-1');
    expect(container.textContent).toContain('Sending');
    await act(async () => {
      resolveReset();
    });
    expect(container.textContent).toContain('Reset email queued');
    await act(async () => {
      root.render(
        createElement(TenantDetailView, {
          tenant: { ...tenant, ownerEmail: null, ownerUserId: null },
          loading: false,
          notFound: false,
          health,
          onTransition: vi.fn(),
          onPasswordReset,
        }),
      );
    });
    const disabledButton = container.querySelectorAll('button')[1];
    expect(disabledButton).toHaveProperty('disabled', true);
    root.unmount();
    container.remove();
  });
});
