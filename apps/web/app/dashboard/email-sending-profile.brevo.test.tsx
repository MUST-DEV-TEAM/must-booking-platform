// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailSendingSetup, type EmailSendingProfile } from './email-sending-profile';
import { UnsavedChangesBoundary } from '../../components/ui/unsaved-changes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = '/api/tenants/tenant/properties/property',
  url = base + '/email-configuration/sending',
  emailsHref = '/dashboard/tenant?propertyId=property&section=settings&settingsArea=emails';
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
});
const brevoApi = (): EmailSendingProfile => ({
  ...defaults(),
  version: 4,
  mode: 'BREVO',
  activeMode: 'BREVO',
  fromName: 'Hotel',
  fromAddress: 'reservations@hotel.test',
  credentialsPresent: true,
  fromVerifiedAt: '2026-11-20T10:00:00Z',
  connectionStatus: 'verified',
});
const brevoSmtp = (): EmailSendingProfile => ({
  ...defaults(),
  version: 3,
  mode: 'SMTP',
  fromAddress: 'reservations@hotel.test',
  smtpHost: 'smtp-relay.brevo.com',
  smtpPort: 587,
  smtpSecurity: 'STARTTLS',
  credentialsPresent: true,
});
type Call = { url: string; method: string; body: Record<string, unknown> | null };
function server(profile: EmailSendingProfile) {
  const state = { profile, calls: [] as Call[] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      state.calls.push(call);
      return Response.json(state.profile);
    }),
  );
  return state;
}
let root: Root | null = null,
  client: QueryClient | null = null;
async function settle() {
  for (let n = 0; n < 3; n++)
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
          createElement(EmailSendingSetup, { base, canWrite, brevo: true, emailsHref }),
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
function button(label: string) {
  const node = maybeButton(label);
  if (!node) throw Error('Missing button ' + label);
  return node;
}
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
const method = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (n) => n.textContent === label,
  )!;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  client?.clear();
  client = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('asks only for what Brevo provides: a connection method and the credentials', async () => {
  server(defaults());
  await render();
  expect(method('API key')).toBeTruthy();
  expect(method('SMTP')).toBeTruthy();
  expect(document.getElementById('sending-secret')).toBeTruthy();
  // No From name, no fall-back switch, no other sending option, no guides.
  expect(document.getElementById('sending-from-name')).toBeNull();
  expect(text()).not.toContain('Fall back');
  expect(document.querySelector('[aria-label="Sending option"]')).toBeNull();
  expect(text()).not.toContain('Own domain through Resend');
  expect(document.querySelector('a[href^="https://help.brevo.com"]')).toBeNull();
  // Opening the setup is not a change the hotel has made.
  expect(button('Save Brevo setup').disabled).toBe(true);
});

it('has none of the later steps: they are on the Emails page, with a link to it', async () => {
  server(brevoApi());
  await render();
  for (const label of [
    'Check saved Brevo connection',
    'Email a verification code',
    'Verify From address',
    'Stop using Brevo',
    'Reload sending setup',
  ])
    expect(maybeButton(label), label).toBeUndefined();
  expect(document.querySelector('ol[aria-label="Setup progress"]')).toBeNull();
  expect(text()).toContain('Finish under Emails, Sending');
  expect(
    document.querySelector<HTMLAnchorElement>('a[href="' + emailsHref + '"]')?.textContent,
  ).toBe('Open Sending');
});

it('asks for the From address while none is saved', async () => {
  server(defaults());
  await render();
  expect(document.getElementById('sending-from-address')).toBeTruthy();
});

it('does not ask for the From address once one is saved', async () => {
  server(brevoApi());
  await render();
  expect(document.getElementById('sending-from-address')).toBeNull();
});

it('connects for the first time with the API key and the From address', async () => {
  const state = server(defaults());
  await render();
  await fill('sending-from-address', 'reservations@hotel.test');
  await fill('sending-secret', 'brevo-api-key-value');
  await click(button('Save Brevo setup'));
  await fill('confirm-reason', 'Connect the hotel Brevo account');
  await click(button('Save setup'));
  const write = state.calls.find((c) => c.method === 'PUT')!;
  expect(write.url).toBe(url);
  expect(write.body).toMatchObject({
    mode: 'BREVO',
    fromName: null,
    fromAddress: 'reservations@hotel.test',
    credentials: { apiKey: 'brevo-api-key-value' },
    reason: 'Connect the hotel Brevo account',
  });
  expect(write.body).not.toHaveProperty('smtpHost');
});

it("connects by SMTP with Brevo's fixed relay and only the login and key", async () => {
  const state = server(defaults());
  await render();
  await click(method('SMTP'));
  expect(text()).toContain('smtp-relay.brevo.com · port 587 · STARTTLS');
  expect(document.getElementById('sending-smtp-host')).toBeNull();
  await fill('sending-from-address', 'reservations@hotel.test');
  await fill('sending-smtp-username', 'a1b2c3001@smtp-brevo.com');
  await fill('sending-secret', 'brevo-smtp-key-value');
  await click(button('Save Brevo setup'));
  await fill('confirm-reason', 'Connect Brevo by SMTP');
  await click(button('Save setup'));
  const write = state.calls.find((c) => c.method === 'PUT')!;
  expect(write.body).toMatchObject({
    mode: 'SMTP',
    smtpHost: 'smtp-relay.brevo.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    credentials: { username: 'a1b2c3001@smtp-brevo.com', password: 'brevo-smtp-key-value' },
  });
});

it('asks for a valid From address and the credentials before saving', async () => {
  const state = server(defaults());
  await render();
  await fill('sending-from-address', 'not-an-address');
  await fill('sending-secret', 'k');
  await click(button('Save Brevo setup'));
  expect(text()).toContain('Enter a valid From email address.');
  expect(state.calls.some((c) => c.method === 'PUT')).toBe(false);
});

it('replaces a key without asking for the From address again, keeping the saved sender', async () => {
  const state = server(brevoApi());
  await render();
  expect(document.getElementById('sending-secret')).toBeNull();
  expect(text()).toContain('The credentials are saved and hidden.');
  expect(text()).toContain('pauses until the sender is verified again');
  await click(
    [...document.querySelectorAll('label')]
      .find((n) => n.textContent === 'Replace saved credentials')!
      .querySelector<HTMLElement>('[role="checkbox"]')!,
  );
  await fill('sending-secret', 'a-new-brevo-key');
  await click(button('Save Brevo setup'));
  await fill('confirm-reason', 'Rotate the Brevo key');
  await click(button('Save setup'));
  const write = state.calls.find((c) => c.method === 'PUT')!;
  expect(write.body).toMatchObject({
    mode: 'BREVO',
    fromName: 'Hotel',
    fromAddress: 'reservations@hotel.test',
    credentials: { apiKey: 'a-new-brevo-key' },
  });
});

it('opens a Brevo SMTP setup on the SMTP method', async () => {
  server(brevoSmtp());
  await render();
  expect(method('SMTP').getAttribute('aria-checked')).toBe('true');
  expect(text()).toContain('smtp-relay.brevo.com · port 587 · STARTTLS');
});

it('warns that saving replaces the sender the hotel uses now', async () => {
  server({ ...defaults(), mode: 'RESEND', activeMode: 'RESEND', domain: 'hotel.test' });
  await render();
  expect(text()).toContain('currently sends with Own domain through Resend');
  expect(text()).toContain('replaces it');
  expect(text()).not.toContain('DNS');
});

it('does not let a viewer change the setup', async () => {
  server(brevoApi());
  await render(false);
  expect(button('Save Brevo setup').disabled).toBe(true);
});
