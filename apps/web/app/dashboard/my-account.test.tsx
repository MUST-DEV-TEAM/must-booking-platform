// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyAccount, parseAccountDate, formatAccountDate } from './my-account';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};
async function mount() {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(MyAccount, { tenantId: 't', role: 'Owner', hotelName: 'Hotel' }),
      ),
    );
    await settle();
  });
  await act(settle);
}
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;
async function type(selector: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  });
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await settle();
  });
}
function stubFetch() {
  const calls: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url === '/api/auth/profile' && !init?.method)
        return Response.json({
          email: 'ana@example.test',
          emailVerified: true,
          firstName: null,
          lastName: null,
        });
      if (url.endsWith('/my-email-preferences') && !init?.method)
        return Response.json({ muteOptionalEmails: false });
      if (init?.method === 'POST' && url.endsWith('/change-password'))
        return new Response(null, { status: 204 });
      return Response.json({});
    }),
  );
  return calls;
}

describe('My account', () => {
  it('shows the profile and saves the name', async () => {
    const calls = stubFetch();
    await mount();
    expect(document.body.textContent).toContain('ana@example.test');
    expect(document.body.textContent).toContain('Email verified');
    expect(document.body.textContent).not.toContain('Not available yet');
    expect(button('Save profile').disabled).toBe(true);
    await type('#account-first-name', 'Ana');
    await type('#account-last-name', 'Owner');
    await click(button('Save profile'));
    const write = calls.find(
      ([url, init]) => url === '/api/auth/profile' && init?.method === 'PATCH',
    )!;
    expect(JSON.parse(String(write[1]!.body))).toMatchObject({
      firstName: 'Ana',
      lastName: 'Owner',
    });
    expect(document.querySelector('#account-birthday')).not.toBeNull();
  });

  it('validates the new password before sending and then changes it', async () => {
    const calls = stubFetch();
    await mount();
    await type('#account-current-password', 'old-password-value');
    await type('#account-new-password', 'short');
    await click(button('Change password'));
    expect(document.body.textContent).toContain('Use at least 12 characters.');
    await type('#account-new-password', 'a-much-longer-password-1');
    await type('#account-confirm-password', 'something-else-entirely');
    await click(button('Change password'));
    expect(document.body.textContent).toContain('do not match');
    expect(calls.some(([url]) => url.endsWith('/change-password'))).toBe(false);
    await type('#account-confirm-password', 'a-much-longer-password-1');
    await click(button('Change password'));
    const send = calls.find(([url]) => url.endsWith('/change-password'))!;
    expect(JSON.parse(String(send[1]!.body))).toEqual({
      currentPassword: 'old-password-value',
      newPassword: 'a-much-longer-password-1',
    });
    expect(document.body.textContent).toContain('Your password was changed.');
  });

  it('turns the optional-email mute on for this hotel only', async () => {
    const calls = stubFetch();
    await mount();
    const toggle = document.querySelector<HTMLElement>('[role="checkbox"]')!;
    await click(toggle);
    const write = calls.find(([, init]) => init?.method === 'PUT')!;
    expect(write[0]).toBe('/api/tenants/t/my-email-preferences');
    expect(JSON.parse(String(write[1]!.body))).toEqual({ muteOptionalEmails: true });
  });
});

it('parses European birthdays and rejects invalid or future dates without swapping day and month', () => {
  expect(parseAccountDate('23/10/1990', 'DD/MM/YYYY')).toBe('1990-10-23');
  expect(parseAccountDate('29/02/2000', 'DD/MM/YYYY')).toBe('2000-02-29');
  expect(parseAccountDate('29/02/2001', 'DD/MM/YYYY')).toBeNull();
  expect(parseAccountDate('01/01/2999', 'DD/MM/YYYY')).toBeNull();
  expect(parseAccountDate('10/23/1990', 'MM/DD/YYYY')).toBe('1990-10-23');
  expect(formatAccountDate('1990-10-23', 'DD/MM/YYYY')).toBe('23/10/1990');
});
