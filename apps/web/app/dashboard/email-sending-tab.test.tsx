// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailSendingTab } from './email-sending-tab';
import type { EmailSendingProfile } from './email-sending-profile';
import { UnsavedChangesBoundary } from '../../components/ui/unsaved-changes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = '/api/tenants/t/properties/p',
  integrationsHref = '/dashboard/t?propertyId=p&section=settings&settingsArea=integrations';
const defaults = (): EmailSendingProfile => ({
  version: 1,
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
  connectionStatus: 'unknown',
  connectionCheckedAt: null,
  connectionOperationId: null,
  connectionExpiresAt: null,
  domainStatus: 'unknown',
  serverOutboundIp: '203.0.113.7',
});
const smtp = (): EmailSendingProfile => ({
  ...defaults(),
  version: 2,
  mode: 'SMTP',
  fromAddress: 'hotel@example.test',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecurity: 'STARTTLS',
  credentialsPresent: true,
});
const brevo = (): EmailSendingProfile => ({
  ...defaults(),
  version: 4,
  mode: 'BREVO',
  activeMode: 'BREVO',
  fromName: 'Hotel',
  fromAddress: 'reservations@hotel.test',
  credentialsPresent: true,
  fromVerifiedAt: '2026-11-20T09:00:00Z',
  connectionStatus: 'verified',
  connectionCheckedAt: '2026-11-20T10:00:00Z',
});
type Call = { url: string; method: string; body: Record<string, unknown> | null };
function server(profile: EmailSendingProfile) {
  const state = { profile, calls: [] as Call[] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      state.calls.push(call);
      if (url === base + '/email-configuration')
        return Response.json({
          version: 1,
          senderName: null,
          replyTo: null,
          defaultLanguage: 'en',
        });
      if (url === base + '/email-sender')
        return Response.json({
          fromAddress: 'booking@mail.example.test',
          replyTo: null,
          hotelName: 'Villa',
        });
      return Response.json(state.profile);
    }),
  );
  return state;
}
let root: Root | null = null,
  client: QueryClient | null = null;
async function settle() {
  for (let n = 0; n < 4; n++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
}
async function render(canWrite = true) {
  client ??= new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          UnsavedChangesBoundary,
          null,
          createElement(EmailSendingTab, { base, canWrite, integrationsHref }),
        ),
      ),
    ),
  );
  await settle();
}
const text = () => document.body.textContent ?? '';
const maybeButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (n) => n.textContent?.trim() === label,
  );
const button = (label: string) => {
  const node = maybeButton(label);
  if (!node) throw Error('Missing button ' + label);
  return node;
};
async function click(node: HTMLElement) {
  await act(async () => node.click());
  await settle();
}
async function fill(id: string, value: string) {
  const node = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  expect(node, id).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}
const sections = () =>
  [...document.querySelectorAll('section[aria-label]')].map((n) => n.getAttribute('aria-label'));
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  client?.clear();
  client = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('says guest emails are sent by the MUST system sender, and offers a provider, when nothing custom is saved', async () => {
  server(defaults());
  await render();
  expect(text()).toContain('How guest emails are sent');
  expect(text()).toContain('Guest emails are sent by the MUST system sender.');
  expect(text()).toContain('Using the MUST sender');
  expect(text()).toContain('booking@mail.example.test');
  expect(text()).toContain(
    'Account and security emails, such as sign-in and invitations, always go through MUST.',
  );
  expect(text()).toContain('Send from your own email provider');
  expect(sections()).toEqual(['Choose your provider']);
  expect(document.querySelector('ol[aria-label="Go-live progress"]')).toBeNull();
  // Brevo's credentials are entered in Integrations, so the provider list here does not offer Brevo.
  const link = document.querySelector<HTMLAnchorElement>(`a[href="${integrationsHref}"]`)!;
  expect(link.textContent).toBe('Connect it in Integrations');
  expect(document.getElementById('email-sender-name')).toBeTruthy();
  expect(document.getElementById('email-reply-to')).toBeTruthy();
});

it('shows the go-live steps in order for a saved custom provider, with the test before switching on', async () => {
  server(smtp());
  await render();
  expect(text()).toContain(
    'Your setup with your own SMTP server is saved but not switched on yet.',
  );
  expect(sections()).toEqual([
    'Step 1: Provider and credentials',
    'Step 2: Check the connection',
    'Step 3: Verify the From address',
    'Step 4: Send a test email',
    'Step 5: Switch it on',
  ]);
  expect(
    document.querySelector('section[aria-label="Step 4: Send a test email"]')!.textContent,
  ).toContain('Optional');
  const progress = [...document.querySelectorAll('ol[aria-label="Go-live progress"] li')];
  expect(progress.map((n) => n.textContent?.replace(/^\d+/, '').replace(' (done)', ''))).toEqual([
    'Credentials saved',
    'Connection checked',
    'From address verified',
    'Switched on',
  ]);
  // Only the saved credentials are done so far.
  expect(progress.map((n) => n.textContent?.includes('(done)'))).toEqual([
    true,
    false,
    false,
    false,
  ]);
});

it('shows Brevo as switched on, with its credentials kept in Integrations', async () => {
  server(brevo());
  await render();
  expect(text()).toContain('Using your own sender');
  expect(text()).toContain('Guest emails are sent by your Brevo account.');
  expect(text()).toContain('Delivery results from Brevo');
  expect(text()).toContain('Brevo is connected. Its API key is kept in Integrations, not here.');
  expect(document.querySelector('a[href="' + integrationsHref + '"]')?.textContent).toBe(
    'Open Brevo in Integrations',
  );
  // No credentials, no provider list, no second place to enter a key.
  expect(document.getElementById('sending-secret')).toBeNull();
  expect(document.querySelector('[aria-label="Sending option"]')).toBeNull();
  const progress = [...document.querySelectorAll('ol[aria-label="Go-live progress"] li')];
  expect(progress.every((n) => n.textContent?.includes('(done)'))).toBe(true);
  expect(sections()).toContain('Step 5: Switch it on');
});

it('changes the fall-back for Brevo without asking for the credentials again', async () => {
  const state = server(brevo());
  await render();
  const save = button('Save');
  expect(save.disabled).toBe(true);
  await click(
    [...document.querySelectorAll('label')]
      .find((n) => n.textContent?.includes('If Brevo fails'))!
      .querySelector<HTMLElement>('[role="checkbox"]')!,
  );
  expect(button('Save').disabled).toBe(false);
  await click(button('Save'));
  await fill('confirm-reason', 'Do not use MUST as a fall-back');
  await click(button('Save setup'));
  const write = state.calls.find((c) => c.method === 'PUT' && c.url.endsWith('/sending'))!;
  expect(write.body).toMatchObject({
    mode: 'BREVO',
    fromAddress: 'reservations@hotel.test',
    fallbackGuest: false,
    reason: 'Do not use MUST as a fall-back',
  });
  expect(write.body).not.toHaveProperty('credentials');
});

it('lets the hotel choose a different provider than Brevo', async () => {
  server(brevo());
  await render();
  await click(button('Use a different provider'));
  expect(document.querySelector('[aria-label="Sending option"]')).toBeTruthy();
  expect(text()).not.toContain('Brevo is connected.');
});

it('numbers the steps of a Resend setup by its domain check', async () => {
  server({
    ...defaults(),
    mode: 'RESEND',
    domain: 'hotel.test',
    fromAddress: 'bookings@hotel.test',
    credentialsPresent: true,
  });
  await render();
  expect(sections()).toEqual([
    'Step 1: Provider and credentials',
    'Step 2: Verify the sending domain',
    'Step 3: Send a test email',
    'Step 4: Switch it on',
  ]);
  const progress = [...document.querySelectorAll('ol[aria-label="Go-live progress"] li')];
  expect(progress.map((n) => n.textContent?.replace(/^\d+/, '').replace(' (done)', ''))).toEqual([
    'Provider saved',
    'Domain verified',
    'Switched on',
  ]);
});

it('does not let a viewer change anything', async () => {
  server(brevo());
  await render(false);
  expect(button('Save').disabled).toBe(true);
  expect(button('Use a different provider').disabled).toBe(true);
  expect(button('Save sender and language').disabled).toBe(true);
});
