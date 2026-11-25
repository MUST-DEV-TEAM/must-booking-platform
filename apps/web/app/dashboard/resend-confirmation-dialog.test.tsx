// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { ResendConfirmationDialog } from './resend-confirmation-dialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;

async function open() {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ResendConfirmationDialog tenantId="t" propertyId="p" bookingId="b" onClose={vi.fn()} />,
    ),
  );
  return async () => {
    await act(async () => root.unmount());
    host.remove();
  };
}

it('sends the confirmation again to the booking address, or to another one, and says where it went', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ sent: true, sentTo: 'a***@example.test' }), {
        status: 200,
      });
    }),
  );
  const close = await open();
  await act(async () => button('Send confirmation').click());
  expect(requests[0]).toEqual({
    url: '/api/tenants/t/properties/p/bookings/b/resend-confirmation',
    body: {},
  });
  expect(document.body.textContent).toContain('sent again to a***@example.test');

  const input = document.querySelector<HTMLInputElement>('#resend-confirmation-email')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(
      input,
      ' other@example.test ',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Send confirmation').click());
  expect(requests[1]!.body).toEqual({ email: 'other@example.test' });
  await close();
});

it('shows the reason when the confirmation cannot be sent', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ message: 'The confirmation was already sent again 3 times today.' }),
          {
            status: 429,
          },
        ),
    ),
  );
  const close = await open();
  await act(async () => button('Send confirmation').click());
  expect(document.body.textContent).toContain('already sent again 3 times today');
  await close();
});
