// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { NotificationTopicSettings } from '@must/domain-contracts';
import { TopicEditor } from './email-configuration';

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
const calls: { url: string; body: Record<string, unknown> }[] = [];
async function mount(canWrite = true, empty = false, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
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
      createElement(TopicEditor, {
        topic,
        options: {
          roleTemplates: [],
          staff: [{ userId: 'staff', name: 'Ana Hotel', email: 'ana@example.test', role: 'STAFF' }],
        },
        base: '/api/tenants/t/properties/p',
        version: 1,
        canWrite,
        refresh: vi.fn(),
      }),
    ),
  );
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
  vi.unstubAllGlobals();
});

it('uses named staff chips and shows a fixed guest token', async () => {
  await mount();
  expect(document.body.textContent).toContain('Ana Hotel');
  expect(document.body.textContent).toContain('Guest (booking email)');
  expect(document.body.textContent).toContain('cannot be replaced here');
});
it('previews unsaved choices through the scoped read-only endpoint', async () => {
  await mount();
  await click(button('Preview recipients'));
  expect(calls).toEqual([
    {
      url: '/api/tenants/t/properties/p/notification-settings/new_booking/preview',
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
  const toggle = document.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  await click(toggle);
  expect(document.body.textContent).toContain('Choices changed. Preview recipients again.');
  expect(document.querySelector('[role="status"]')).toBeNull();
});
it('warns when an enabled staff topic resolves to nobody', async () => {
  await mount(true, true);
  await click(button('Preview recipients'));
  expect(document.body.textContent).toContain('No staff will receive this email');
  expect(document.body.textContent).toContain('blocked@example.test (complaint)');
});
it('allows read-only preview but keeps saving and editing disabled', async () => {
  await mount(false);
  expect(button('Save new booking').disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.disabled).toBe(true);
  await click(button('Preview recipients'));
  expect(document.body.textContent).toContain('current@example.test');
});
it('shows endpoint errors without a fabricated recipient result', async () => {
  await mount(true, false, 403);
  await click(button('Preview recipients'));
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
  await click(button('Preview recipients'));
  expect(calls[0].body.rules).toEqual([
    { target: 'STAFF_USER', userId: 'staff', channel: 'TO' },
    { target: 'EMAIL', email: 'private@example.test', channel: 'BCC' },
  ]);
});
