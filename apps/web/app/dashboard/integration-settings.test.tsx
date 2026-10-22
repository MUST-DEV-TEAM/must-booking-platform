// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IntegrationSettings } from './integration-settings';
vi.mock('./clock-sync', () => ({ ClockSyncStatus: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const wait = async () => {
  await new Promise((r) => setTimeout(r, 50));
};
async function mount(canWrite: boolean) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (init?.method === 'PATCH')
        return Response.json(
          {
            message:
              'Replacement credentials failed verification. The existing connection has been kept.',
          },
          { status: 400 },
        );
      return Response.json(
        path.endsWith('/properties/p/integration-connections')
          ? [{ connectionId: 'c', enabled: true }]
          : [
              {
                id: 'c',
                provider: 'CLOCK_PMS',
                name: 'Working Clock',
                status: 'CONNECTED',
                lastTestedAt: null,
              },
            ],
      );
    }),
  );
  const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    }),
    root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(IntegrationSettings, { tenantId: 't', propertyId: 'p', canWrite }),
      ),
    );
    await wait();
  });
  await act(wait);
  return {
    calls,
    close: async () => {
      await act(async () => root.unmount());
      client.clear();
    },
  };
}
describe('integration settings', () => {
  it('shows assignment and hides credential actions for a read-only viewer', async () => {
    const v = await mount(false);
    expect(document.body.textContent).toContain('Enabled for this hotel');
    expect(document.body.textContent).not.toContain('Replace credentials');
    await v.close();
  });
  it('never preloads a secret and retains a working connection on replacement failure', async () => {
    const v = await mount(true);
    await act(async () =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent === 'Replace credentials')!
        .click(),
    );
    const password = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(password.value).toBe('');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        password,
        'fixture-replacement',
      );
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      document
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await wait();
    });
    const write = v.calls.find((c) => c.init?.method === 'PATCH');
    expect(write?.path).toContain('/credentials');
    expect(JSON.parse(String(write!.init!.body))).toEqual({
      credentials: { apiKey: 'fixture-replacement' },
    });
    expect(document.body.textContent).toContain('existing connection has been kept');
    expect(document.body.textContent).toContain('Enabled for this hotel');
    await v.close();
  });
});
