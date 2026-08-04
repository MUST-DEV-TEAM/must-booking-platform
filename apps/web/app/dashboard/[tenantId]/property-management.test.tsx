// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { PropertyManagement } from './property-management';
import { DashboardQueryProvider } from '../query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PropertyManagement', () => {
  it('shows a loading state until the properties lookup resolves', async () => {
    let resolveProperties: (response: Response) => void;
    let resolveUsage: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolve) => {
            if (url.endsWith('/plan-usage')) resolveUsage = resolve;
            else resolveProperties = resolve;
          }),
      ),
    );
    const { container, root } = await mount(false);

    expect(container.textContent).toContain('Loading properties…');
    resolveProperties!(propertiesResponse());
    resolveUsage!(usageResponse());
    await settle();
    expect(container.textContent).toContain('Grand Hotel');
    await act(async () => root.unmount());
  });

  it('retries the properties lookup after an error', async () => {
    let shouldFail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        shouldFail ? new Response('{}', { status: 500 }) : responseFor(url),
      ),
    );
    const { container, root } = await mount();

    expect(container.textContent).toContain('Unable to load properties.');
    shouldFail = false;
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Retry')!
        .click(),
    );
    await settle();
    expect(container.textContent).toContain('Grand Hotel');
    await act(async () => root.unmount());
  });

  it('reports property creation outcomes through Sonner', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('{}', { status: 500 });
      return new Response(
        JSON.stringify(
          _url.endsWith('/plan-usage')
            ? { plan: { maxProperties: 2 }, usage: { properties: 1 } }
            : [{ id: 'p', name: 'Grand Hotel', address: '1 Main St', timezone: 'Europe/Tirane' }],
        ),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    await submit(container);

    expect(toast.error).toHaveBeenCalledWith('Unable to create property.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it('keeps the plan-cap message when creation is refused', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('{}', { status: 409 });
      return responseFor(url);
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    await submit(container);

    expect(toast.error).toHaveBeenCalledWith('Upgrade to unlock more properties.');
    await act(async () => root.unmount());
  });

  it('reports successful property creation through Sonner', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('{}');
      return responseFor(url);
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    await submit(container);

    expect(toast.success).toHaveBeenCalledWith('Property created.');
    await act(async () => root.unmount());
  });
});

async function mount(settled = true) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(PropertyManagement, { tenantId: 'tenant-1' }),
      ),
    );
  });
  if (settled) await settle();
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

async function submit(container: HTMLElement) {
  await act(async () => {
    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

function responseFor(url: string) {
  return url.endsWith('/plan-usage') ? usageResponse() : propertiesResponse();
}

function propertiesResponse() {
  return new Response(
    JSON.stringify([
      { id: 'p', name: 'Grand Hotel', address: '1 Main St', timezone: 'Europe/Tirane' },
    ]),
  );
}

function usageResponse() {
  return new Response(JSON.stringify({ plan: { maxProperties: 2 }, usage: { properties: 1 } }));
}
