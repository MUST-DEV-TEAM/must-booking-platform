// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IntegrationSettings } from './integration-settings';
vi.mock('./clock-sync', () => ({ ClockSyncStatus: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const wait = async () => {
  await new Promise((r) => setTimeout(r, 50));
};
async function mount(canWrite: boolean, provider = 'CLOCK_PMS') {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (path.endsWith('/credentials') && init?.method === 'GET')
        return Response.json({
          fields:
            provider === 'POKPAY'
              ? {
                  keyId: 'saved-staging-id',
                  merchantId: 'saved-merchant',
                  keySecret: '***tail',
                  baseUrl: 'https://api-staging.pokpay.io',
                  webhookUrl: 'https://must.example/api/webhooks/pokpay',
                }
              : {
                  host: 'sky-eu1.clock-software.com',
                  accountId: '123',
                  subscriptionId: '456',
                  apiUser: 'fixture-user',
                  apiKey: '***cret',
                },
        });
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
                provider,
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

/** The card of one integration, found by its logo. */
const card = (alt: string) =>
  [...document.querySelectorAll('[data-slot="card"]')].find((c) =>
    c.querySelector(`img[alt="${alt}"]`),
  )!;
/** Radix tabs switch on mouse down, not on click. */
const selectTab = async (dialog: Element, label: string) => {
  await act(async () => {
    [...dialog.querySelectorAll('[role="tab"]')]
      .find((t) => t.textContent === label)!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await wait();
  });
};
/** Opens an integration's Details, goes to Credentials and presses Change credentials. */
async function openCredentialsEditor(alt: string) {
  await act(async () => {
    [...card(alt).querySelectorAll('button')].find((b) => b.textContent === 'Details')!.click();
    await wait();
  });
  const dialog = document.querySelector('[role="dialog"]')!;
  await selectTab(dialog, 'Credentials');
  await act(async () => {
    [...dialog.querySelectorAll('button')]
      .find((b) => b.textContent === 'Change credentials')!
      .click();
    await wait();
  });
  // The edit dialog then loads the saved values; wait for them as the earlier tests did.
  await act(wait);
}
describe('integration settings', () => {
  it('shows assignment and hides credential actions for a read-only viewer', async () => {
    const v = await mount(false);
    expect(document.body.textContent).toContain('Enabled for this hotel');
    expect(document.body.textContent).not.toContain('Replace credentials');
    await v.close();
  });
  it('keeps staging separate when opening a blank production configuration', async () => {
    const v = await mount(true, 'POKPAY');
    await openCredentialsEditor('PokPay');
    const env = document.querySelector<HTMLButtonElement>('[aria-label="PokPay environment"]')!;
    expect(env.disabled).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[aria-label="Key ID"]')!.value).toBe(
      'saved-staging-id',
    );
    await act(async () => {
      env.click();
    });
    await act(async () =>
      document.querySelector<HTMLElement>('[role="option"][data-state="unchecked"]')!.click(),
    );
    expect(document.querySelector<HTMLInputElement>('[aria-label="Key ID"]')!.value).toBe('');
    expect(document.querySelector('[aria-label="Webhook URL"]')).toBeNull();
    // The Environment choice is the dropdown only; it is not asked for again as a typed text box.
    expect(document.querySelector('input[aria-label="Environment"]')).toBeNull();
    await act(async () => {
      env.click();
    });
    await act(async () =>
      document.querySelector<HTMLElement>('[role="option"][data-state="unchecked"]')!.click(),
    );
    await act(wait);
    expect(document.querySelector<HTMLInputElement>('[aria-label="Key ID"]')!.value).toBe(
      'saved-staging-id',
    );
    expect(document.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    expect(v.calls.some((c) => c.init?.method === 'POST' || c.init?.method === 'PATCH')).toBe(
      false,
    );
    await v.close();
  });
  it('never preloads a secret and retains a working connection on replacement failure', async () => {
    const v = await mount(true);
    await openCredentialsEditor('Clock PMS+');
    expect(document.body.textContent).toContain('***cret');
    expect(document.querySelector<HTMLInputElement>('input[value="fixture-user"]')).not.toBeNull();
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
  it("shows the synchronization in the Clock card's details, as its own tab", async () => {
    const v = await mount(true);
    expect(document.body.textContent).not.toContain('What is being brought in from Clock');
    expect(
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Synchronization'),
    ).toBe(false);
    await act(async () => {
      [...card('Clock PMS+').querySelectorAll('button')]
        .find((b) => b.textContent === 'Details')!
        .click();
      await wait();
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    await selectTab(dialog, 'Synchronization');
    expect(dialog.textContent).toContain('What is being brought in from Clock PMS+');
    await v.close();
  });
  it('has no Synchronization tab on the PokPay card', async () => {
    const v = await mount(true, 'POKPAY');
    await act(async () => {
      [...card('PokPay').querySelectorAll('button')]
        .find((b) => b.textContent === 'Details')!
        .click();
      await wait();
    });
    const tabs = [...document.querySelectorAll('[role="dialog"] [role="tab"]')].map(
      (t) => t.textContent,
    );
    expect(tabs).toEqual(['Overview', 'Credentials', 'Activity']);
    await v.close();
  });
  it('tests the saved connection from the Overview of its details, not from the card', async () => {
    const v = await mount(true);
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Test')).toBe(
      false,
    );
    await act(async () => {
      [...card('Clock PMS+').querySelectorAll('button')]
        .find((b) => b.textContent === 'Details')!
        .click();
      await wait();
    });
    await act(async () => {
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent === 'Check connection now')!
        .click();
      await wait();
    });
    expect(
      v.calls.some(
        (c) => c.path.endsWith('/integration-connections/c/test') && c.init?.method === 'POST',
      ),
    ).toBe(true);
    await v.close();
  });
});
