// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardQueryProvider } from './query-provider';
import { ReportDefinitions } from './report-definitions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 75));
}
async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(ReportDefinitions, { tenantId: 't', propertyId: 'p' }),
      ),
    ),
  );
  return host;
}
async function click(button: Element) {
  await act(async () => {
    (button as HTMLButtonElement).click();
    await settle();
  });
}
async function rendered(text: string) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(document.body.textContent).toContain(text);
  });
}
const data = { timezone: 'Europe/Tirane', basis: 'MUST locally stored records', definitions: [] };

describe('Reports Definitions dialog', () => {
  it('loads only when opened, shows metadata, and closes accessibly', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(data)));
    vi.stubGlobal('fetch', fetch);
    const host = await mount();
    expect(fetch).not.toHaveBeenCalled();
    await click(host.querySelector('button')!);
    expect(fetch).toHaveBeenCalledWith('/api/tenants/t/properties/p/reports/definitions', {
      credentials: 'include',
    });
    await rendered('Europe/Tirane');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Europe/Tirane');
    expect(document.body.textContent).toContain('No metric definitions available');
    await click(document.querySelector('[role="dialog"] button')!);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('shows denied permissions without money or invented definitions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    const host = await mount();
    await click(host.querySelector('button')!);
    await rendered('Reports permission is required');
    expect(document.body.textContent).not.toContain('Room revenue');
  });
  it('shows a reference and retries a failed request', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', { status: 500, headers: { 'x-request-id': 'reports-test-ref' } }),
      )
      .mockResolvedValue(new Response(JSON.stringify(data)));
    vi.stubGlobal('fetch', fetch);
    const host = await mount();
    await click(host.querySelector('button')!);
    await rendered('reports-test-ref');
    const retry = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    await click(retry);
    await rendered('Europe/Tirane');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
