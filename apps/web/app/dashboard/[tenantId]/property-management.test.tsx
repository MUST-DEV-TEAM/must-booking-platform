// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PropertyManagement } from './property-management';
import { DashboardQueryProvider } from '../query-provider';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
async function mount(fetch: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetch);
  root = createRoot(document.body.appendChild(document.createElement('div')));
  const close = vi.fn();
  await act(async () =>
    root.render(
      <DashboardQueryProvider>
        <PropertyManagement tenantId="t" onClose={close} />
      </DashboardQueryProvider>,
    ),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  return close;
}
async function submit() {
  await act(async () => {
    for (const [name, value] of Object.entries({
      name: 'New hotel',
      address: 'Tirana',
      timezone: 'Europe/Tirane',
    })) {
      const input = document.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
      input.value = value;
    }
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
it('keeps the existing create payload, success and close flow', async () => {
  const fetch = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === 'POST' ? {} : { plan: { maxProperties: 2 }, usage: { properties: 1 } },
        ),
      ),
  );
  const close = await mount(fetch);
  await submit();
  expect(fetch).toHaveBeenCalledWith(
    '/api/tenants/t/properties',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'New hotel', address: 'Tirana', timezone: 'Europe/Tirane' }),
    }),
  );
  expect(close).toHaveBeenCalled();
});
it('disables creation at the plan cap', async () => {
  await mount(
    vi.fn(
      async () =>
        new Response(JSON.stringify({ plan: { maxProperties: 1 }, usage: { properties: 1 } })),
    ),
  );
  expect(document.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
  expect(document.body.textContent).toContain('plan hotel limit');
});
it.each([409, 500])('handles a create refusal %s without closing', async (status) => {
  const close = await mount(
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response('{}', { status })
        : new Response(JSON.stringify({ plan: { maxProperties: 2 }, usage: { properties: 1 } })),
    ),
  );
  await submit();
  expect(close).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(
    status === 409 ? 'plan hotel limit' : 'Unable to create hotel',
  );
});

it('retries a failed plan lookup before enabling creation', async () => {
  let failed = true;
  await mount(
    vi.fn(async () =>
      failed
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ plan: { maxProperties: 2 }, usage: { properties: 1 } })),
    ),
  );
  expect(document.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
  failed = false;
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'Try again')!
      .click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  expect(document.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(false);
});
