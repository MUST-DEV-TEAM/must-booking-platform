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
const wait = () => new Promise((r) => setTimeout(r, 50));

type Stripe = { id: string; name: string; mode: 'TEST' | 'LIVE'; webhookPublicId: string };
async function mount(accounts: Stripe[], inUse?: string) {
  const calls: Array<{ path: string; method?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method });
      if (init?.method === 'PATCH') return Response.json({});
      if (path.endsWith('/integration-setup'))
        return Response.json({
          pokpayWebhookUrl: 'https://x.test/api/webhooks/pokpay',
          stripeWebhookBase: 'https://x.test/api/webhooks/stripe',
        });
      if (path.includes('/credentials'))
        return Response.json({ fields: { secretKey: '***1234', webhookSecret: '****' } });
      return Response.json(
        path.endsWith('/properties/p/integration-connections')
          ? inUse
            ? [{ connectionId: inUse, enabled: true }]
            : []
          : accounts.map((a) => ({ ...a, provider: 'STRIPE', status: 'CONNECTED' })),
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(IntegrationSettings, { tenantId: 't', propertyId: 'p', canWrite: true }),
      ),
    );
    await wait();
  });
  await act(wait);
  return calls;
}
const button = (label: string, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (label: string) =>
  act(async () => {
    button(label)!.click();
    await wait();
  });

const sandbox: Stripe = {
  id: 'sandbox',
  name: 'Stripe Sandbox',
  mode: 'TEST',
  webhookPublicId: 'w1',
};
const live: Stripe = { id: 'live', name: 'Stripe Live', mode: 'LIVE', webhookPublicId: 'w2' };

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
describe('Stripe in Settings > Integrations', () => {
  it('is no longer "coming soon": a hotel without Stripe can activate it', async () => {
    await mount([]);
    const stripeCard = [...document.querySelectorAll('[data-slot="card"]')].find((c) =>
      c.querySelector('img[alt="Stripe"]'),
    )!;
    expect(stripeCard.textContent).not.toContain('Coming soon');
    expect(button('Activate', stripeCard)).toBeTruthy();
  });

  it('labels test and live keys and explains that test payments are not real money', async () => {
    await mount([sandbox, live], 'sandbox');
    const badges = [...document.querySelectorAll('[data-slot="badge"]')].map((x) => x.textContent);
    expect(badges).toEqual(expect.arrayContaining(['Test', 'Live']));
    const open = async (name: string) => {
      const target = [...document.querySelectorAll('[data-slot="card"]')].find((c) =>
        c.textContent?.includes(name),
      )!;
      await act(async () => {
        [...target.querySelectorAll('button')].find((b) => b.textContent === 'Details')!.click();
        await wait();
      });
    };
    await open('Stripe Sandbox');
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      'Test account: payments are not real money.',
    );
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait();
    });
  });

  it("shows the connection's own webhook address and asks for the signing secret", async () => {
    await mount([sandbox], 'sandbox');
    await openCredentialsEditor('Stripe');
    await act(wait);
    expect(document.body.textContent).toContain('https://x.test/api/webhooks/stripe/w1');
    expect(document.body.textContent).toContain('checkout.session.completed');
    const labels = [...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Secret key', 'Webhook secret']));
  });

  it('asks only for the key when adding an account (the webhook address comes after saving)', async () => {
    await mount([sandbox], 'sandbox');
    await act(async () => {
      [...card('Stripe').querySelectorAll('button')]
        .find((b) => b.textContent === 'Details')!
        .click();
      await wait();
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    await selectTab(dialog, 'Credentials');
    await act(async () => {
      [...dialog.querySelectorAll('button')]
        .find((b) => b.textContent === 'Add another Stripe account (test or live)')!
        .click();
      await wait();
    });
    const labels = [...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label'));
    expect(labels).toContain('Secret key');
    expect(labels).not.toContain('Webhook secret');
    expect(document.body.textContent).toContain(
      'you get an address to add in your Stripe Dashboard',
    );
  });

  it('confirms before switching Stripe from test to live and back', async () => {
    const calls = await mount([sandbox, live], 'sandbox');
    await click('Switch to live');
    expect(document.body.textContent).toContain('Go live with Stripe?');
    expect(document.body.textContent).toContain('Stripe Sandbox');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await act(async () => {
      button('Go live', document.querySelector('[role="dialog"]')!)!.click();
      await wait();
    });
    expect(calls.some((c) => c.method === 'PATCH' && c.path.endsWith('/live'))).toBe(true);
  });
});
