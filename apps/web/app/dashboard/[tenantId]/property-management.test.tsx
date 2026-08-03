// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { PropertyManagement } from './property-management';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PropertyManagement', () => {
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
});

async function mount() {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PropertyManagement, { tenantId: 'tenant-1' }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

async function submit(container: HTMLElement) {
  await act(async () => {
    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}
