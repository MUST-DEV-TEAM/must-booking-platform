// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { NotificationTopicSettings } from '@must/domain-contracts';
import { StaffNotificationPanel } from './email-staff-notifications';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const topic: NotificationTopicSettings = {
  topic: 'new_booking',
  label: 'New booking',
  hasGuestEmail: true,
  hasStaffEmail: true,
  guestEnabled: true,
  staffEnabled: true,
  customStaffRecipients: true,
  daysOffset: null,
  rules: [{ target: 'STAFF_USER', userId: 'staff' }],
  staffRecipients: [{ email: 'saved@example.test' }],
};
let root: Root | undefined;
const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
const onSaved = vi.fn(async () => undefined);
const onClose = vi.fn();
async function mount(
  canWrite = true,
  empty = false,
  status = 200,
  panelTopic: NotificationTopicSettings = topic,
  onEditWording?: () => void,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return Response.json(
        status === 200
          ? {
              guest: true,
              staff: empty ? [] : [{ email: 'current@example.test' }],
              suppressed: empty ? [{ email: 'blocked@example.test', reason: 'complaint' }] : [],
            }
          : { message: 'Not allowed' },
        { status },
      );
    }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(StaffNotificationPanel, {
        topic: panelTopic,
        options: {
          roleTemplates: [],
          staff: [{ userId: 'staff', name: 'Ana Hotel', email: 'ana@example.test', role: 'STAFF' }],
        },
        base: '/api/tenants/t/properties/p',
        version: 1,
        canWrite,
        onSaved,
        onClose,
        onEditWording,
      }),
    ),
  );
}
function radio(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!result) throw Error('Missing choice ' + label);
  return result;
}
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!result) throw Error('Missing button ' + label);
  return result;
}
async function click(node: HTMLElement) {
  await act(async () => node.click());
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  calls.length = 0;
  onSaved.mockClear();
  onClose.mockClear();
  vi.unstubAllGlobals();
});

it('uses named staff chips and shows a fixed guest token', async () => {
  await mount();
  expect(document.body.textContent).toContain('Ana Hotel');
  expect(document.body.textContent).toContain(
    'the guest also gets an email, at the address on the booking',
  );
  // The guest email is not changed here: no guest switch, no guest address field.
  expect(document.body.textContent).not.toContain('Send guest email');
});
it('previews unsaved choices through the scoped read-only endpoint', async () => {
  await mount();
  await click(button('Preview who gets it'));
  expect(calls).toEqual([
    {
      url: '/api/tenants/t/properties/p/notification-settings/new_booking/preview',
      method: 'POST',
      body: {
        guestEnabled: true,
        staffEnabled: true,
        customStaffRecipients: true,
        rules: [{ target: 'STAFF_USER', userId: 'staff', channel: 'TO' }],
      },
    },
  ]);
  expect(document.body.textContent).toContain('current@example.test');
  expect(document.body.textContent).toContain('Nothing was saved or sent');
  await click(radio('Default recipients'));
  expect(document.body.textContent).toContain('Choices changed. Preview who gets it again.');
  expect(document.querySelector('[role="status"]')).toBeNull();
});
it('warns when an enabled staff topic resolves to nobody', async () => {
  await mount(true, true);
  await click(button('Preview who gets it'));
  expect(document.body.textContent).toContain('No staff will receive this email');
  expect(document.body.textContent).toContain('blocked@example.test (complaint)');
});
it('allows read-only preview but keeps saving and editing disabled', async () => {
  await mount(false);
  expect(button('Save').disabled).toBe(true);
  expect(radio('Custom list').disabled).toBe(true);
  await click(button('Preview who gets it'));
  expect(document.body.textContent).toContain('current@example.test');
});
it('shows endpoint errors without a fabricated recipient result', async () => {
  await mount(true, false, 403);
  await click(button('Preview who gets it'));
  expect(document.body.textContent).toContain('Not allowed');
  expect(document.querySelector('[role="status"]')).toBeNull();
});

it('offers separate shared To, CC and BCC selectors and submits an external BCC choice', async () => {
  await mount();
  for (const channel of ['TO', 'CC', 'BCC'])
    expect(
      document.querySelector(`[aria-label="New booking ${channel} recipients"]`),
    ).not.toBeNull();
  const channelPicker = document.querySelector<HTMLButtonElement>(
    '[aria-label="New booking extra address channel"]',
  )!;
  await click(channelPicker);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === 'BCC',
  )!;
  await click(option.querySelector('button')!);
  const input = document.querySelector<HTMLInputElement>('[aria-label="New booking extra email"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'private@example.test',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(button('Add address'));
  await click(button('Preview who gets it'));
  expect(calls[0].body.rules).toEqual([
    { target: 'STAFF_USER', userId: 'staff', channel: 'TO' },
    { target: 'EMAIL', email: 'private@example.test', channel: 'BCC' },
  ]);
});

it('replaces the two staff switches with one choice: default recipients, a custom list or nobody', async () => {
  await mount();
  expect(radio('Default recipients').getAttribute('aria-checked')).toBe('false');
  expect(radio('Custom list').getAttribute('aria-checked')).toBe('true');
  expect(radio('Nobody')).toBeTruthy();
  expect(document.body.textContent).not.toContain('Send staff email');
  expect(document.body.textContent).not.toContain('Use custom staff recipients');
});
it('explains who the default recipients are, and shows the list only for a custom one', async () => {
  await mount(true, false, 200, { ...topic, customStaffRecipients: false, rules: [] });
  expect(document.body.textContent).toContain(
    'The staff member assigned to the booking, or the owners.',
  );
  expect(document.querySelector('[aria-label="New booking TO recipients"]')).toBeNull();
  await click(radio('Custom list'));
  expect(document.querySelector('[aria-label="New booking TO recipients"]')).not.toBeNull();
});
it('saves Nobody as the staff email switched off, and leaves the guest email as it was', async () => {
  await mount();
  await click(radio('Nobody'));
  expect(document.body.textContent).toContain('No staff email is sent for this notification.');
  await click(button('Save'));
  const save = calls.find((c) => c.method === 'PUT');
  expect(save?.url).toBe('/api/tenants/t/properties/p/email-configuration/topics/new_booking');
  expect(save?.body).toMatchObject({
    version: 1,
    guestEnabled: true,
    staffEnabled: false,
    customStaffRecipients: false,
    rules: [],
  });
  expect(onSaved).toHaveBeenCalled();
});
it('does not offer Nobody for problem alerts, which always need someone', async () => {
  await mount(true, false, 200, {
    ...topic,
    topic: 'owner_alerts',
    label: 'Problem alerts',
    hasGuestEmail: false,
    customStaffRecipients: false,
    rules: [],
  });
  expect([...document.querySelectorAll('[role="radio"]')].map((n) => n.textContent)).toEqual([
    'Default recipients',
    'Custom list',
  ]);
  expect(document.body.textContent).not.toContain('the guest also gets an email');
});
it('offers the wording of the staff email, and nothing when there is none', async () => {
  const open = vi.fn();
  await mount(true, false, 200, topic, open);
  await click(button('Edit the wording'));
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  await mount();
  expect(
    [...document.querySelectorAll('button')].some((n) => n.textContent === 'Edit the wording'),
  ).toBe(false);
});
