// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IntegrationSettings } from './integration-settings';
vi.mock('./clock-sync', () => ({ ClockSyncStatus: () => null }));
vi.mock('./venues/restaurant-integration-card', () => ({
  RestaurantIntegrationCard: () => createElement('div', null, 'Restaurants card'),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const wait = () => new Promise((r) => setTimeout(r, 50));

type Account = {
  id: string;
  provider: 'STRIPE' | 'POKPAY' | 'CLOCK_PMS';
  name: string;
  status: string;
  mode?: 'TEST' | 'LIVE';
  webhookPublicId?: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
};
const stripe: Account = {
  id: 's1',
  provider: 'STRIPE',
  name: 'Stripe Sandbox',
  status: 'CONNECTED',
  mode: 'TEST',
  webhookPublicId: 'w1',
  lastTestedAt: '2026-11-20T10:00:00.000Z',
  lastTestResult: 'Stripe accepted the key.',
};
const pokpay: Account = {
  id: 'p1',
  provider: 'POKPAY',
  name: 'PokPay Staging',
  status: 'FAILED',
  mode: 'TEST',
  lastTestedAt: null,
  lastTestResult: null,
};

const SAVED: Record<string, Record<string, string>> = {
  STRIPE: {
    secretKey: '***1234',
    webhookSecret: '****',
    publishableKey: 'pk_test_visible_123',
  },
  POKPAY: {
    keyId: 'saved-key-id',
    keySecret: '***tail',
    merchantId: 'merchant-77',
    webhookUrl: 'https://must.example/api/webhooks/pokpay',
  },
};

const SENDING = {
  version: 3,
  mode: 'DEFAULT',
  activeMode: 'DEFAULT',
  fromName: null,
  fromAddress: null,
  domain: null,
  smtpHost: null,
  smtpPort: null,
  smtpSecurity: null,
  fallbackGuest: true,
  credentialsPresent: false,
  fromVerifiedAt: null,
  connectionCheckedAt: null,
  connectionStatus: 'unknown',
  connectionOperationId: null,
  connectionExpiresAt: null,
  domainStatus: 'unknown',
  serverOutboundIp: '203.0.113.7',
};

async function mount(
  accounts: Account[],
  canWrite = true,
  website?: { origin: string | null; pairedAt: string | null; form: ReactNode },
  sending: Record<string, unknown> | null = SENDING,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/credentials') && init?.method === 'GET') {
        const id = path.split('/').at(-2);
        return Response.json({
          fields: SAVED[accounts.find((a) => a.id === id)?.provider ?? 'STRIPE'],
        });
      }
      if (path.endsWith('/email-configuration/sending'))
        return sending ? Response.json(sending) : Response.json({ message: 'no' }, { status: 500 });
      if (path.endsWith('/integration-setup'))
        return Response.json({
          pokpayWebhookUrl: 'https://must.example/api/webhooks/pokpay',
          stripeWebhookBase: 'https://must.example/api/webhooks/stripe',
        });
      return Response.json(
        path.endsWith('/properties/p/integration-connections')
          ? [{ connectionId: 's1', enabled: true }]
          : accounts,
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
        createElement(IntegrationSettings, { tenantId: 't', propertyId: 'p', canWrite, website }),
      ),
    );
    await wait();
  });
  await act(wait);
}
const cards = () => [...document.querySelectorAll('[data-slot="card"]')];
const card = (alt: string) => cards().find((c) => c.querySelector(`img[alt="${alt}"]`))!;
const button = (label: string, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (element: Element | undefined) =>
  act(async () => {
    (element as HTMLElement).click();
    await wait();
  });
/** Radix tabs switch on mouse down, not on click. */
const select = async (element: Element | undefined) =>
  act(async () => {
    element!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await wait();
  });
const tab = (label: string, within: ParentNode = document) =>
  [...within.querySelectorAll('[role="tab"]')].find((t) => t.textContent === label);
const search = async (text: string) =>
  act(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search integrations"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
  });

describe('the integrations marketplace', () => {
  it('lists the categories, says what each card is for and what it owns, and shows its health', async () => {
    await mount([stripe, pokpay]);
    const names = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(names).toEqual([
      'All',
      'Property systems',
      'Payments',
      'Email',
      'Website',
      'Channels',
      'Restaurants',
    ]);
    expect(document.body.textContent).toContain('Owns: online payments through Stripe');
    expect(document.body.textContent).toContain(
      'Owns: rooms, rates, availability and reservations',
    );
    expect(document.body.textContent).toContain('Working');
    expect(document.body.textContent).toContain('Stripe accepted the key.');
    expect(document.body.textContent).toContain('Last check failed');
    expect(document.body.textContent).toContain('Not connected yet');
  });

  it('gives every card the same structure: a title, a role, what it owns, a status and at most two buttons', async () => {
    await mount([stripe, pokpay], true, {
      origin: null,
      pairedAt: null,
      form: createElement('div'),
    });
    const all = cards();
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const c of all) {
      expect(c.textContent).toContain('Owns:');
      const buttons = [...c.querySelectorAll('button')];
      expect(buttons.map((b) => b.textContent)[0]).toBe('Details');
      expect(buttons.length).toBeLessThanOrEqual(2);
      // "Credentials" and "Synchronization" are inside the details now, not on the cards.
      for (const label of ['Credentials', 'Synchronization'])
        expect(button(label, c)).toBeUndefined();
    }
  });

  it('keeps the coming-soon integrations small, apart from the cards, with a way to ask for another', async () => {
    await mount([]);
    const soon = document.querySelector('section[aria-label="Coming soon"]')!;
    for (const name of ['Raiffeisen', 'PayPal', 'Booking.com', 'Airbnb', 'SMTP email'])
      expect(soon.textContent).toContain(name);
    expect(cards().some((c) => c.textContent?.includes('Booking.com'))).toBe(false);
    expect(button('Request')).toBeTruthy();
  });

  it('filters by category and by search', async () => {
    await mount([stripe], true, { origin: null, pairedAt: null, form: createElement('div') });
    await select(tab('Property systems'));
    expect(document.body.textContent).toContain(
      'Owns: rooms, rates, availability and reservations',
    );
    expect(document.body.textContent).not.toContain('Owns: online payments through Stripe');
    await select(tab('Restaurants'));
    expect(document.body.textContent).toContain('Restaurants card');
    expect(document.body.textContent).not.toContain(
      'Owns: rooms, rates, availability and reservations',
    );
    await select(tab('Website'));
    expect(document.body.textContent).toContain('Owns: the booking pages');
    await select(tab('All'));
    await search('stripe');
    expect(document.body.textContent).toContain('Owns: online payments through Stripe');
    expect(document.body.textContent).not.toContain(
      'Owns: rooms, rates, availability and reservations',
    );
    await search('zzzz');
    expect(document.body.textContent).not.toContain('Owns: online payments through Stripe');
    expect(document.body.textContent).toContain('Need another integration?');
  });
});

describe('an integration in detail', () => {
  it('has Overview, Credentials and Activity, and can check the connection now', async () => {
    await mount([stripe]);
    await click(button('Details', card('Stripe')));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Stripe Sandbox');
    expect(dialog.textContent).toContain('Test account: payments are not real money.');
    expect(dialog.textContent).toContain('Enabled for this hotel');
    expect(button('Check connection now', dialog)).toBeTruthy();
    await select(tab('Activity', dialog));
    expect(dialog.textContent).toContain('A full history of calls and errors is not recorded yet.');
  });

  it('lists the saved credentials: safe values in full, secrets only by their last four characters', async () => {
    await mount([stripe, { ...pokpay, status: 'CONNECTED' }]);
    await click(button('Details', card('PokPay')));
    const dialog = document.querySelector('[role="dialog"]')!;
    await select(tab('Credentials', dialog));
    const text = dialog.textContent ?? '';
    expect(text).toContain('saved-key-id');
    expect(text).toContain('merchant-77');
    expect(text).toContain('https://must.example/api/webhooks/pokpay');
    expect(text).toContain('•••• tail');
    expect(text).toContain('Hidden for security');
    const labels = [...dialog.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    // A secret is never offered for copying; a safe value is.
    expect(labels).not.toContain('Copy key secret');
    expect(labels).toContain('Copy key id');
  });

  it("shows Stripe's keys the same way, and the webhook address", async () => {
    await mount([stripe]);
    await click(button('Details', card('Stripe')));
    const dialog = document.querySelector('[role="dialog"]')!;
    await select(tab('Credentials', dialog));
    const text = dialog.textContent ?? '';
    expect(text).toContain('pk_test_visible_123');
    expect(text).toContain('•••• 1234');
    expect(text).toContain('https://must.example/api/webhooks/stripe/w1');
    expect(text).not.toContain('***1234');
  });

  it('tells a viewer without edit rights that credentials cannot be changed', async () => {
    await mount([stripe], false);
    await click(button('Details', card('Stripe')));
    const dialog = document.querySelector('[role="dialog"]')!;
    await select(tab('Credentials', dialog));
    expect(button('Change credentials', dialog)).toBeUndefined();
    expect(dialog.textContent).toContain(
      'You can view this connection but not change its credentials.',
    );
  });

  it('says what an unconnected integration needs and offers to activate it', async () => {
    await mount([]);
    await click(button('Details', card('Stripe')));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('What you need to connect it');
    expect(dialog.textContent).toContain('Secret key');
    expect(tab('Credentials', dialog)).toBeUndefined();
    await click(button('Activate', dialog));
    expect(document.body.textContent).toContain('Enter the account details below.');
  });

  it('explains what happens when a new connection is activated', async () => {
    await mount([]);
    await click(button('Activate', card('Stripe')));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(
      'We check them with Stripe. Nothing is saved if the check fails.',
    );
    expect(dialog.textContent).toContain('Test accounts stay in test mode');
  });
});

describe('the Website card', () => {
  const websiteCard = () =>
    cards().find((c) => c.textContent?.includes('Owns: the booking pages'))!;

  it('replaces the separate section: its form is inside the card, opened by Connect', async () => {
    await mount([], true, {
      origin: 'https://hotel.test',
      pairedAt: null,
      form: createElement('div', null, 'The website form'),
    });
    expect(document.body.textContent).not.toContain('The website form');
    expect(websiteCard().textContent).toContain('Address saved, not connected yet');
    await click(button('Connect', websiteCard()));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('The website form');
  });

  it('shows when it is connected and offers Manage', async () => {
    await mount([], true, {
      origin: 'https://hotel.test',
      pairedAt: '2026-11-01T10:00:00.000Z',
      form: createElement('div', null, 'The website form'),
    });
    expect(websiteCard().textContent).toContain('Connected');
    expect(button('Manage', websiteCard())).toBeTruthy();
  });

  it('shows the address in Details and hides Connect from a viewer', async () => {
    await mount([], false, {
      origin: 'https://hotel.test',
      pairedAt: null,
      form: createElement('div'),
    });
    expect(button('Connect', websiteCard())).toBeUndefined();
    await click(button('Details', websiteCard()));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('https://hotel.test');
  });
});

describe('the Brevo card', () => {
  const brevoCard = () => cards().find((c) => c.textContent?.includes('Owns: the hotel'))!;
  const ACTIVE = {
    ...SENDING,
    mode: 'BREVO',
    activeMode: 'BREVO',
    fromName: 'Hotel',
    fromAddress: 'reservations@hotel.test',
    connectionStatus: 'verified',
    connectionCheckedAt: '2026-11-20T10:00:00.000Z',
    fromVerifiedAt: '2026-11-20T09:00:00.000Z',
    credentialsPresent: true,
  };
  const SMTP_ACTIVE = {
    ...ACTIVE,
    mode: 'SMTP',
    activeMode: 'SMTP',
    smtpHost: 'smtp-relay.brevo.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
  };
  const openDetails = async () => {
    await click(button('Details', brevoCard()));
    return document.querySelector('[role="dialog"]')!;
  };

  it('has the same card structure as the others, with the Brevo logo', async () => {
    await mount([]);
    expect(brevoCard().querySelector('img[src="/integrations/brevo.svg"]')).toBeTruthy();
    expect(brevoCard().textContent).toContain('Owns: the hotel');
    expect([...brevoCard().querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Details',
      'Connect',
    ]);
  });

  it('says guest emails are sent by the MUST system sender until Brevo is connected', async () => {
    await mount([]);
    expect(brevoCard().textContent).toContain('Not connected');
    expect(brevoCard().textContent).toContain('Guest emails are sent by the MUST system sender.');
  });

  it('offers Manage in Emails once connected, and shows that guest emails go out through Brevo', async () => {
    await mount([], true, undefined, ACTIVE);
    expect(brevoCard().textContent).toContain('Sending guest emails');
    expect(brevoCard().textContent).toContain(
      'through your Brevo account as reservations@hotel.test',
    );
    const labels = [...brevoCard().querySelectorAll('button, a')].map((n) => n.textContent);
    expect(labels).toEqual(['Details', 'Manage in Emails']);
    const manage = [...brevoCard().querySelectorAll('a')].find(
      (a) => a.textContent === 'Manage in Emails',
    )!;
    expect(manage.getAttribute('href')).toContain('emails');
  });

  it('shows a saved but not active setup, a failed connection, and an unreadable setup', async () => {
    await mount([], true, undefined, { ...SENDING, mode: 'BREVO', connectionStatus: 'unknown' });
    expect(brevoCard().textContent).toContain('Set up, not active');
    document.body.replaceChildren();
    await mount([], true, undefined, { ...SENDING, mode: 'BREVO', connectionStatus: 'failed' });
    expect(brevoCard().textContent).toContain('Connection failed');
    document.body.replaceChildren();
    await mount([], true, undefined, null);
    expect(brevoCard().textContent).toContain('Status unavailable');
  });

  it("counts Brevo SMTP as Brevo, and another provider's SMTP as not Brevo", async () => {
    await mount([], true, undefined, SMTP_ACTIVE);
    expect(brevoCard().textContent).toContain('Sending guest emails');
    document.body.replaceChildren();
    await mount([], true, undefined, { ...SMTP_ACTIVE, smtpHost: 'smtp.example.com' });
    expect(brevoCard().textContent).toContain('Not connected');
  });

  it('before it is connected, the popup is Overview only: what is needed and a Connect button', async () => {
    await mount([]);
    const dialog = await openDetails();
    expect(dialog.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(tab('Overview', dialog)).toBeTruthy();
    expect(dialog.textContent).toContain('Brevo is an email platform.');
    expect(dialog.textContent).toContain('What you need to connect it');
    expect(dialog.textContent).toContain('An API key, or an SMTP login and an SMTP key');
    expect(dialog.textContent).not.toContain('instead of the MUST system email');
    expect(dialog.querySelector('a[href^="https://help.brevo.com"]')).toBeNull();
    expect(dialog.querySelector('img[src="/integrations/brevo.svg"]')).toBeTruthy();
  });

  it('opens the credentials dialog from Connect, on the card or in the popup', async () => {
    await mount([]);
    await click(button('Connect', brevoCard()));
    let dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Connect Brevo');
    expect(dialog.textContent).toContain('Connection method');
    expect(dialog.textContent).toContain('From address');
    expect(dialog.querySelector('[aria-label="Sending option"]')).toBeNull();
    document.body.replaceChildren();
    await mount([]);
    await openDetails();
    await click(button('Connect Brevo', document.querySelector('[role="dialog"]')!));
    dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Connection method');
    expect(dialog.textContent).not.toContain('Brevo is an email platform.');
  });

  it('once connected, the popup has Overview, Credentials and Activity like the others', async () => {
    await mount([], true, undefined, ACTIVE);
    const dialog = await openDetails();
    expect([...dialog.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      'Overview',
      'Credentials',
      'Activity',
    ]);
    for (const text of [
      'Guest emails sent by',
      'From address',
      'reservations@hotel.test',
      'From address verified',
      'Connection',
    ])
      expect(dialog.textContent).toContain(text);
    expect(dialog.textContent).toContain('Guest emails go out through Brevo.');
    expect(button('Open Emails', dialog) ?? dialog.querySelector('a')).toBeTruthy();
  });

  it('lists the saved credentials like the others: details in full, the key only as saved and hidden', async () => {
    await mount([], true, undefined, ACTIVE);
    const dialog = await openDetails();
    await select(tab('Credentials', dialog));
    const text = dialog.textContent ?? '';
    expect(text).toContain('Connection method');
    expect(text).toContain('API key');
    expect(text).toContain('reservations@hotel.test');
    expect(text).toContain('Saved · hidden');
    const labels = [...dialog.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Copy from address');
    expect(labels).not.toContain('Copy api key');
    await click(button('Change credentials', dialog));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Brevo credentials');
  });

  it('shows the SMTP server and login for an SMTP setup, the login and key hidden', async () => {
    await mount([], true, undefined, SMTP_ACTIVE);
    const dialog = await openDetails();
    await select(tab('Credentials', dialog));
    const text = dialog.textContent ?? '';
    expect(text).toContain('SMTP');
    expect(text).toContain('smtp-relay.brevo.com:587');
    expect(text).toContain('SMTP login');
    expect(text).toContain('SMTP key');
    expect(text.match(/Saved · hidden/g)).toHaveLength(2);
    expect(
      [...dialog.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
    ).toContain('Copy server');
  });

  it('has an Activity tab that says Brevo keeps the log of every message', async () => {
    await mount([], true, undefined, ACTIVE);
    const dialog = await openDetails();
    await select(tab('Activity', dialog));
    expect(dialog.textContent).toContain('Last check:');
    expect(dialog.textContent).toContain('guest emails go out through Brevo');
    expect(dialog.textContent).toContain('Brevo keeps the log of every message');
  });

  it('shows the failure hint only when the saved Brevo connection has failed', async () => {
    await mount([], true, undefined, {
      ...ACTIVE,
      activeMode: 'DEFAULT',
      connectionStatus: 'failed',
    });
    let dialog = await openDetails();
    expect(dialog.textContent).toContain('Brevo may be blocking this server, or the key is wrong.');
    expect(dialog.textContent).toContain('203.0.113.7');
    document.body.replaceChildren();
    await mount([], true, undefined, ACTIVE);
    dialog = await openDetails();
    expect(dialog.textContent).not.toContain('Brevo may be blocking this server');
  });

  it('gives a viewer the details but nothing to change', async () => {
    await mount([], false, undefined, ACTIVE);
    expect([...brevoCard().querySelectorAll('button, a')].map((n) => n.textContent)).toEqual([
      'Details',
    ]);
    const dialog = await openDetails();
    await select(tab('Credentials', dialog));
    expect(button('Change credentials', dialog)).toBeUndefined();
    expect(dialog.textContent).toContain(
      'You can view this connection but not change its credentials.',
    );
    document.body.replaceChildren();
    await mount([], false);
    const unconnected = await openDetails();
    expect(button('Connect Brevo', unconnected)).toBeUndefined();
  });

  it('is found by searching for Brevo or for email, and sits in the Email category', async () => {
    await mount([stripe]);
    await select(tab('Email'));
    expect(brevoCard()).toBeTruthy();
    expect(document.body.textContent).not.toContain('Owns: online payments through Stripe');
    await select(tab('All'));
    await search('brevo');
    expect(brevoCard()).toBeTruthy();
    expect(document.body.textContent).not.toContain('Owns: online payments through Stripe');
  });
});

describe('the integration request form', () => {
  const fill = async (id: string, text: string) =>
    act(async () => {
      const element = document.querySelector<HTMLInputElement>('#' + id)!;
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(element, text);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await wait();
    });
  const dialog = () => document.querySelector('[role="dialog"]')!;

  it('opens from "Need another integration?" and asks what the team needs to know', async () => {
    await mount([]);
    await click(button('Request'));
    for (const label of [
      'Name of the system',
      'Kind of integration',
      'Website of the system',
      'What would you use it for?',
      'Do you already use it?',
      'How soon do you need it?',
      'Anything else we should know?',
    ])
      expect(dialog().textContent).toContain(label);
  });

  it('asks for the missing details instead of sending an empty request', async () => {
    await mount([]);
    await click(button('Request'));
    await click(button('Send request', dialog()));
    expect(dialog().textContent).toContain('Enter the name of the system.');
    expect(dialog().textContent).toContain('Choose what kind of integration it is.');
    expect(dialog().textContent).toContain('Tell us what you would use it for');
    expect([...dialog().querySelectorAll('a')].some((a) => a.textContent === 'Send request')).toBe(
      false,
    );
  });

  it('refuses a website address that is not a web address', async () => {
    await mount([]);
    await click(button('Request'));
    await fill('request-link', 'not a link');
    await click(button('Send request', dialog()));
    expect(dialog().textContent).toContain('Enter a full web address');
  });

  it('prepares an email to the team with every detail once it is complete', async () => {
    await mount([]);
    await click(button('Request'));
    await fill('request-name', 'Mews');
    await fill('request-link', 'https://mews.com');
    await fill('request-why', 'Keep our reservations and rooms in sync with Mews.');
    await click(document.querySelector('#request-category'));
    await click(
      [...document.querySelectorAll('[role="option"]')].find(
        (o) => o.textContent === 'Property system',
      ),
    );
    // Complete, so Send request is now a link that opens the email.
    const link = [...dialog().querySelectorAll('a')].find((a) => a.textContent === 'Send request')!;
    const href = link.getAttribute('href')!;
    expect(href).toMatch(/^mailto:[^?]+\?subject=/);
    const url = new URL(href);
    expect(decodeURIComponent(url.searchParams.get('subject')!)).toBe('Integration request: Mews');
    const body = url.searchParams.get('body')!;
    for (const line of [
      'Name: Mews',
      'Category: Property system',
      'Website: https://mews.com',
      'We would use it for: Keep our reservations and rooms in sync with Mews.',
      'We already use it: No, we are looking at it',
      'How soon we need it: Needed soon',
    ])
      expect(body).toContain(line);
  });

  it('offers to copy the request for people without an email app', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await mount([]);
    await click(button('Request'));
    await fill('request-name', 'Mews');
    await fill('request-why', 'Keep our reservations and rooms in sync with Mews.');
    await click(document.querySelector('#request-category'));
    await click(
      [...document.querySelectorAll('[role="option"]')].find(
        (o) => o.textContent === 'Property system',
      ),
    );
    await click(button('Copy request', dialog()));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain('Name: Mews');
  });
});
