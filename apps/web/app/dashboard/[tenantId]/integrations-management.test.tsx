// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { IntegrationsManagement } from './integrations-management';
import { DashboardQueryProvider } from '../query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const connection = {
  id: 'conn-1',
  kind: 'PAYMENT' as const,
  provider: 'STRIPE' as const,
  name: 'Main Stripe',
  status: 'PENDING' as const,
  lastTestedAt: null,
  lastTestResult: null,
};

describe('IntegrationsManagement', () => {
  it('lists connections and shows the property-assignment checkbox state', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tenants/t/integration-connections')
        return new Response(JSON.stringify([connection]));
      if (url === '/api/tenants/t/properties/p/integration-connections')
        return new Response(
          JSON.stringify([
            {
              connectionId: 'conn-1',
              kind: 'PAYMENT',
              provider: 'STRIPE',
              name: 'Main Stripe',
              enabled: true,
            },
          ]),
        );
      return new Response(JSON.stringify([]));
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    expect(container.textContent).toContain('Main Stripe');
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await act(async () => root.unmount());
  });

  it('creates a connection and reports success through Sonner', async () => {
    let createdCredentials: unknown;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/tenants/t/integration-connections' && init?.method === 'POST') {
        createdCredentials = JSON.parse(String(init.body)).credentials;
        return new Response(JSON.stringify({ ...connection, id: 'conn-2' }));
      }
      if (url === '/api/tenants/t/integration-connections') return new Response(JSON.stringify([]));
      if (url === '/api/tenants/t/properties/p/integration-connections')
        return new Response(JSON.stringify([]));
      return new Response(JSON.stringify([]));
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    const nameInput = container.querySelector('input[placeholder="e.g. Main Stripe account"]')!;
    const keyInput = container.querySelector('input[placeholder="Field name (e.g. secretKey)"]')!;
    const valueInput = container.querySelector('input[placeholder="Value"]')!;
    await act(async () => {
      nameInput.dispatchEvent(new Event('focus'));
      Object.defineProperty(nameInput, 'value', { value: 'Main Stripe', writable: true });
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      Object.defineProperty(keyInput, 'value', { value: 'secretKey', writable: true });
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      Object.defineProperty(valueInput, 'value', { value: 'sk_test_x', writable: true });
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      const form = container.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(toast.success).toHaveBeenCalledWith('Connection created.');
    expect(createdCredentials).toEqual({ secretKey: 'sk_test_x' });
    await act(async () => root.unmount());
  });

  it('reports a failed test result through Sonner without claiming success', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/tenants/t/integration-connections/conn-1/test' && init?.method === 'POST')
        return new Response(
          JSON.stringify({
            ...connection,
            status: 'FAILED',
            lastTestResult: 'Connection testing for this provider is not available yet.',
          }),
        );
      if (url === '/api/tenants/t/integration-connections')
        return new Response(JSON.stringify([connection]));
      if (url === '/api/tenants/t/properties/p/integration-connections')
        return new Response(JSON.stringify([]));
      return new Response(JSON.stringify([]));
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Test connection')!
        .click();
    });
    await settle();

    expect(toast.error).toHaveBeenCalledWith(
      'Connection testing for this provider is not available yet.',
    );
    await act(async () => root.unmount());
  });
});

async function mount() {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(IntegrationsManagement, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
  await settle();
  return { container, root };
}

async function settle() {
  await act(async () => {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      await Promise.resolve();
    }
  });
}
