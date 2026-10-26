// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it, expect, vi } from 'vitest';
import { GuestBookingManage } from './guest-booking-manage';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function mount(automaticAllowed: boolean) {
  window.history.replaceState(
    {},
    '',
    '/booking/manage?tenant=t&property=p&booking=b&token=signed-link',
  );
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json(
        init?.method === 'POST'
          ? automaticAllowed
            ? { cancelled: true, message: 'Your booking is cancelled.' }
            : { requested: true }
          : {
              reference: 'MUST-100',
              status: 'CONFIRMED',
              version: 2,
              startsOn: '2030-07-10',
              endsOn: '2030-07-12',
              room: 'Double',
              currency: 'EUR',
              cutoffAt: '2030-06-19T13:00:00Z',
              timezone: 'Europe/Tirane',
              policyKnown: true,
              automaticAllowed,
              refundAmount: automaticAllowed ? '99.99' : null,
            },
      );
    }),
  );
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root!.render(createElement(GuestBookingManage));
    await new Promise((r) => setTimeout(r, 30));
  });
  return calls;
}
it('opens a read-only booking preview without sending a cancellation', async () => {
  const calls = await mount(true);
  expect(document.body.textContent).toContain('99.99 EUR');
  expect(calls.every((c) => c.init?.method !== 'POST')).toBe(true);
});
it.each([true, false])(
  'requires confirmation and preserves the displayed action (automatic=%s)',
  async (automatic) => {
    const calls = await mount(automatic);
    const submit = () =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === (automatic ? 'Confirm cancellation' : 'Send cancellation request'),
      )!;
    expect(submit().disabled).toBe(true);
    const area = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        area,
        'Travel plans changed',
      );
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].at(-1)!.click(),
    );
    await act(async () => submit().click());
    const sent = calls.find((c) => c.init?.method === 'POST')!;
    expect(JSON.parse(sent.init!.body as string)).toMatchObject({
      action: automatic ? 'cancel' : 'request',
      token: 'signed-link',
      version: 2,
    });
    expect(document.body.textContent).toContain(
      automatic ? 'Your booking is cancelled.' : 'Your booking remains active',
    );
  },
);
