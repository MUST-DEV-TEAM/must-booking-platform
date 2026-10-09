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
    expect(container.textContent).toContain('pending');
    const assignments = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Assigned properties'),
    )!;
    expect(assignments.getAttribute('aria-expanded')).toBe('false');
    await act(async () => assignments.click());
    expect(assignments.getAttribute('aria-expanded')).toBe('true');
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

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Add a connection'))!
        .click();
    });

    const nameInput = container.querySelector('input[placeholder="e.g. Main Stripe account"]')!;
    const secretKeyInput = fieldInput(container, 'Secret key');
    const webhookSecretInput = fieldInput(container, 'Webhook secret');
    await act(async () => {
      setValue(nameInput, 'Main Stripe');
      setValue(secretKeyInput, 'sk_test_x');
      setValue(webhookSecretInput, 'whsec_x');
    });
    await act(async () => {
      const form = container.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(toast.success).toHaveBeenCalledWith('Connection created.');
    expect(createdCredentials).toEqual({ secretKey: 'sk_test_x', webhookSecret: 'whsec_x' });
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
      (
        container.querySelector('[aria-label="Actions for Main Stripe"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('[role="menuitem"]'))
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

describe('ClockCatalogSync', () => {
  it('shows only when a Clock PMS connection is active, and lists proposed mappings', async () => {
    const clockConnection = {
      ...connection,
      id: 'conn-clock',
      provider: 'CLOCK_PMS' as const,
      kind: 'PMS' as const,
    };
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tenants/t/integration-connections')
        return new Response(JSON.stringify([clockConnection]));
      if (url === '/api/tenants/t/properties/p/integration-connections')
        return new Response(
          JSON.stringify([
            {
              connectionId: 'conn-clock',
              kind: 'PMS',
              provider: 'CLOCK_PMS',
              name: 'Clock',
              enabled: true,
            },
          ]),
        );
      if (url === '/api/tenants/t/properties/p/clock-catalog/mappings')
        return new Response(
          JSON.stringify([
            {
              id: 'm1',
              entityType: 'ROOM_TYPE',
              externalEntityId: '1',
              externalParentId: null,
              externalName: 'Standard',
              syncStatus: 'PROPOSED',
              localEntityId: null,
            },
          ]),
        );
      return new Response(JSON.stringify([]));
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    expect(container.textContent).toContain('Clock catalog sync');
    expect(container.textContent).toContain('Standard');
    await act(async () => root.unmount());
  });
});

function fieldInput(container: HTMLElement, label: string): HTMLInputElement {
  const span = Array.from(container.querySelectorAll('.must-field__label')).find(
    (element) => element.textContent === label,
  )!;
  return span.parentElement!.querySelector('input')!;
}

function setValue(input: HTMLInputElement, value: string) {
  Object.defineProperty(input, 'value', { value, writable: true });
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mount() {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(IntegrationsManagement, {
          tenantId: 't',
          properties: [{ id: 'p', name: 'Property' }],
        }),
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
