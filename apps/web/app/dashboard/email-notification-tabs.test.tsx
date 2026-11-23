// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { NotificationTopicSettings } from '@must/domain-contracts';
import { EmailGuestEmails } from './email-guest-emails';
import { EmailStaffNotifications } from './email-staff-notifications';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = '/api/tenants/t/properties/p';
const topic = (
  name: string,
  label: string,
  over: Partial<NotificationTopicSettings> = {},
): NotificationTopicSettings => ({
  topic: name,
  label,
  hasGuestEmail: true,
  hasStaffEmail: false,
  guestEnabled: true,
  staffEnabled: false,
  customStaffRecipients: false,
  daysOffset: null,
  rules: [],
  staffRecipients: [],
  ...over,
});
const topics: NotificationTopicSettings[] = [
  topic('new_booking', 'New booking', {
    hasStaffEmail: true,
    staffEnabled: true,
    staffRecipients: [{ email: 'owner@hotel.test' }],
  }),
  topic('booking_changed', 'Booking changed', {
    hasStaffEmail: true,
    staffEnabled: true,
    customStaffRecipients: true,
    rules: [{ target: 'EMAIL', email: 'front@hotel.test', channel: 'TO' }],
    staffRecipients: [
      { email: 'front@hotel.test', channel: 'TO' },
      { email: 'night@hotel.test', channel: 'CC' },
      { email: 'a@hotel.test', channel: 'BCC' },
      { email: 'b@hotel.test', channel: 'BCC' },
      { email: 'c@hotel.test', channel: 'BCC' },
    ],
  }),
  topic('refund_processed', 'Refund processed', {
    guestEnabled: false,
    hasStaffEmail: true,
    staffEnabled: false,
  }),
  topic('pre_arrival', 'Pre-arrival reminder', {
    daysOffset: { value: 3, min: 1, max: 30, label: 'Days before check-in' },
  }),
  topic('payment_reminder', 'Payment reminder', {
    daysOffset: { value: 3, min: 1, max: 6, label: 'Days after the payment link was sent' },
  }),
  topic('owner_alerts', 'Problem alerts', {
    hasGuestEmail: false,
    guestEnabled: false,
    hasStaffEmail: true,
    staffEnabled: true,
    staffRecipients: [],
  }),
];
const templates = [
  'booking_confirmed',
  'booking_confirmed_pay_at_hotel',
  'booking_changed',
  'refund_processed',
  'pre_arrival',
  'payment_reminder',
  'staff_new_booking',
  'owner_alerts',
  'payment_failed',
].map((key) => ({
  key,
  label: key,
  locales: key === 'pre_arrival' ? ['en', 'sq'] : ['en'],
  hasDraft: key === 'booking_changed',
}));
type Call = { url: string; method: string; body: Record<string, unknown> | null };
function server() {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      if (url.endsWith('/email-configuration')) return Response.json({ version: 7 });
      if (url.endsWith('/notification-settings'))
        return Response.json({ topics, options: { roleTemplates: [], staff: [] } });
      return Response.json({});
    }),
  );
  return calls;
}
let root: Root | null = null,
  client: QueryClient | null = null;
async function settle() {
  for (let n = 0; n < 4; n++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
}
async function render(node: ReactNode) {
  client ??= new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(QueryClientProvider, { client }, node)));
  await settle();
}
const editor = (template: { key: string }, onClose: () => void): ReactNode =>
  createElement('div', null, [
    createElement('p', { key: 'p' }, `EDITOR ${template.key}`),
    createElement('button', { key: 'b', onClick: onClose }, 'Close editor'),
  ]);
const guest = (canWrite = true) =>
  render(createElement(EmailGuestEmails, { base, canWrite, templates, renderEditor: editor }));
const staff = (canWrite = true, footer?: ReactNode) =>
  render(
    createElement(EmailStaffNotifications, {
      base,
      canWrite,
      templates,
      renderEditor: editor,
      footer,
    }),
  );
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
  const node = document.getElementById(id) as HTMLInputElement;
  expect(node, id).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}
const rowOf = (label: string) =>
  [...document.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(label))!;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  client?.clear();
  client = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------ Guest emails

it('lists the guest emails by stage of the stay, with when each is sent and in which languages', async () => {
  server();
  await guest();
  expect(
    [...document.querySelectorAll('section[aria-label]')].map((n) => n.getAttribute('aria-label')),
  ).toEqual(['Booking', 'Payments', 'Stay']);
  expect(rowOf('Pre-arrival reminder').textContent).toContain('3 days before check-in');
  expect(rowOf('Pre-arrival reminder').textContent).toContain('EN · SQ');
  expect(rowOf('Payment reminder').textContent).toContain('3 days after the payment link was sent');
  expect(rowOf('Booking confirmation').textContent).toContain('When a booking is confirmed');
  expect(rowOf('Booking changed').textContent).toContain('Draft waiting');
  // Only emails that exist are listed.
  expect(text()).not.toContain('Check-in day message');
  expect(text()).not.toContain('payment_failed');
});

it('locks the booking and payment emails, and gives the stay emails and booking changed a switch', async () => {
  server();
  await guest();
  expect(rowOf('Booking confirmation').textContent).toContain('Always sent');
  expect(rowOf('Booking confirmation').querySelector('[role="switch"]')).toBeNull();
  expect(rowOf('Payment reminder').textContent).toContain('Always sent');
  const preArrival = rowOf('Pre-arrival reminder').querySelector<HTMLElement>('[role="switch"]')!;
  expect(preArrival.getAttribute('aria-label')).toBe('Send Pre-arrival reminder');
  expect(preArrival.getAttribute('aria-checked')).toBe('true');
  expect(rowOf('Booking changed').querySelector('[role="switch"]')).toBeTruthy();
});

it('shows an always-sent email that was switched off as Off, and turns it back on', async () => {
  const calls = server();
  await guest();
  expect(rowOf('Refund').textContent).toContain('Off');
  expect(rowOf('Refund').querySelector('[role="switch"]')).toBeNull();
  await click(button('Turn on'));
  const save = calls.find((c) => c.method === 'PUT')!;
  expect(save.url).toBe(`${base}/email-configuration/topics/refund_processed`);
  expect(save.body).toMatchObject({ version: 7, guestEnabled: true, staffEnabled: false });
});

it('switches a stay email off from the list, keeping its timing and its staff settings', async () => {
  const calls = server();
  await guest();
  await click(rowOf('Pre-arrival reminder').querySelector<HTMLElement>('[role="switch"]')!);
  const save = calls.find((c) => c.method === 'PUT')!;
  expect(save.url).toBe(`${base}/email-configuration/topics/pre_arrival`);
  expect(save.body).toMatchObject({
    version: 7,
    guestEnabled: false,
    customStaffRecipients: false,
    rules: [],
    daysOffset: 3,
  });
  expect(save.body).not.toHaveProperty('staffEnabled');
});

it('opens one email with its sending settings above its wording', async () => {
  server();
  await guest();
  await click(button('Pre-arrival reminder'));
  expect(text()).toContain('When and whether it is sent');
  expect(text()).toContain('Sent: 3 days before check-in');
  expect(text()).toContain('EDITOR pre_arrival');
  expect(button('Save').disabled).toBe(true);
  await click(button('← Guest emails'));
  expect(text()).toContain('Every email your guests can receive');
});

it('saves a new timing from the editor, and refuses one outside the allowed range', async () => {
  const calls = server();
  await guest();
  await click(button('Pre-arrival reminder'));
  await fill('guest-email-days', '45');
  expect(text()).toContain('Enter a whole number from 1 to 30.');
  expect(button('Save').disabled).toBe(true);
  await fill('guest-email-days', '5');
  expect(text()).toContain('Sent: 5 days before check-in');
  await click(button('Save'));
  const save = calls.find((c) => c.method === 'PUT')!;
  expect(save.body).toMatchObject({ version: 7, guestEnabled: true, daysOffset: 5 });
});

it('says an always-sent email cannot be switched off when it is opened', async () => {
  server();
  await guest();
  await click(button('Booking confirmation'));
  expect(text()).toContain('Always sent. Guests need this email, so it cannot be switched off.');
  expect(document.querySelector('[role="switch"]')).toBeNull();
});

it('offers both wordings of the booking confirmation', async () => {
  server();
  await guest();
  await click(button('Booking confirmation'));
  expect(text()).toContain('EDITOR booking_confirmed');
  const choice = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (n) => n.textContent === 'Pay at the hotel',
  )!;
  await click(choice);
  expect(text()).toContain('EDITOR booking_confirmed_pay_at_hotel');
});

it('does not let a viewer change anything on the Guest emails list', async () => {
  server();
  await guest(false);
  expect(
    rowOf('Pre-arrival reminder').querySelector<HTMLButtonElement>('[role="switch"]')!.disabled,
  ).toBe(true);
  expect(maybeButton('Turn on')).toBeUndefined();
});

// ------------------------------------------------------------------ Staff notifications

it('lists only the notifications staff receive, and who receives each', async () => {
  server();
  await staff();
  const rows = [...document.querySelectorAll('tbody tr')].map((tr) => tr.children[0]?.textContent);
  expect(rows).toEqual(['New booking', 'Booking changed', 'Refund processed', 'Problem alerts']);
  const booking = rowOf('New booking').textContent ?? '';
  expect(booking).toContain('Guest');
  expect(booking).toContain('owner@hotel.test');
  expect(booking).toContain('The staff member assigned to the booking, or the owners');
  const changed = rowOf('Booking changed').textContent ?? '';
  expect(changed).toContain('front@hotel.test');
  expect(changed).toContain('CC: night@hotel.test');
  expect(changed).toContain('+2 more');
  expect(changed).toContain('Custom list');
  expect(rowOf('Refund processed').textContent).toContain('Staff: nobody');
  expect(rowOf('Problem alerts').textContent).toContain('No staff recipients');
});

it('opens a side panel for one notification, and goes to its wording and back', async () => {
  server();
  await staff();
  await click(document.querySelector<HTMLElement>('[aria-label="Edit New booking"]')!);
  expect(text()).toContain('Choose who on your team receives this notification.');
  await click(button('Edit the wording'));
  expect(text()).toContain('EDITOR staff_new_booking');
  expect(text()).not.toContain('Choose who on your team');
  await click(button('← Staff notifications'));
  expect(text()).toContain('Who receives each notification.');
});

it('has no wording to edit for a notification without a staff email wording', async () => {
  server();
  await staff();
  await click(document.querySelector<HTMLElement>('[aria-label="Edit Booking changed"]')!);
  // The fixture has no staff wording for this one.
  expect(maybeButton('Edit the wording')).toBeUndefined();
});

it('shows what is under the table once the list is open', async () => {
  server();
  await staff(true, createElement('p', null, 'Smaller cards'));
  expect(text()).toContain('Smaller cards');
});
