// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { PricingEditor } from './pricing-editor';
import { PricingBaseEditor } from './pricing-base-editor';
import { PricingPreviewPanel } from './pricing-preview';
import type { PricingWorkspace } from './pricing-types';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const plan = {
  id: 'p',
  name: 'Flexible',
  currency: 'EUR',
  lifecycle: 'Active',
  version: 2,
  roomTypeIds: [],
  channels: ['website', 'staff'],
  pricingBasis: 'independent',
  isFallback: true,
};
const data: PricingWorkspace = {
  source: 'LOCAL',
  readOnly: false,
  today: '2036-02-28',
  timezone: 'UTC',
  bookingMode: 'ROOM_TYPE_ONLY',
  pricingVersion: 4,
  roomTypes: [{ id: 't', name: 'King', status: 'PUBLISHED' }],
  rooms: [],
  plans: [plan],
  rules: [],
  charges: [],
  base: [],
  roomOverrides: [],
  issues: [],
  coverage: null,
};
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function mount(element: React.ReactNode) {
  const c = document.createElement('div');
  document.body.append(c);
  root = createRoot(c);
  await act(async () => root!.render(element));
  return c;
}
async function fill(id: string, value: string) {
  const e = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(id)!;
  expect(e).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )!.set!.call(e, value);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) {
  const b = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  )!;
  expect(b).toBeTruthy();
  await act(async () => b.click());
}
describe('Pricing editors', () => {
  it('retries the same draft with the same key, null percentage currency and retained fields', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ message: 'Temporary failure' }, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ id: 'r', name: 'Season', version: 1, lifecycle: 'Draft', roomTypeIds: [] }),
      );
    vi.stubGlobal('fetch', fetch);
    const saved = vi.fn();
    await mount(
      createElement(PricingEditor, {
        base: '/pricing',
        kind: 'rules',
        data,
        onClose: vi.fn(),
        onStored: vi.fn(),
        onSaved: saved,
      }),
    );
    await fill('#pricing-name', 'Season');
    await fill('#pricing-value', '10');
    await click('Save draft');
    expect(document.body.textContent).toContain('Temporary failure');
    expect((document.querySelector('#pricing-name') as HTMLInputElement).value).toBe('Season');
    await click('Save draft');
    expect(fetch).toHaveBeenCalledTimes(2);
    const [a, b] = fetch.mock.calls;
    expect(a![1].headers['Idempotency-Key']).toBe(b![1].headers['Idempotency-Key']);
    expect(JSON.parse(b![1].body)).toMatchObject({ name: 'Season', value: '10', currency: null });
    expect(saved).toHaveBeenCalledOnce();
  });
  it('retains the saved draft after publication fails and requires a new version when editing it', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ id: 'r', name: 'Season', version: 1, lifecycle: 'Draft', roomTypeIds: [] }),
      )
      .mockResolvedValueOnce(
        Response.json({ message: 'Equal-priority pricing rules overlap' }, { status: 409 }),
      );
    vi.stubGlobal('fetch', fetch);
    const stored = vi.fn(),
      saved = vi.fn();
    await mount(
      createElement(PricingEditor, {
        base: '/pricing',
        kind: 'rules',
        data,
        onClose: vi.fn(),
        onStored: stored,
        onSaved: saved,
      }),
    );
    await fill('#pricing-name', 'Season');
    await fill('#pricing-value', '10');
    await click('Save and activate');
    expect(stored).toHaveBeenCalledOnce();
    expect(saved).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('The saved draft is retained.');
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ version: 1 });
  });
  it('converts an inclusive leap-day selection to an exclusive bulk end and waits for confirmation', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        version: 4,
        previewToken: 'token',
        valid: true,
        changes: [{ roomTypeId: 't', date: '2036-02-29', before: '90.00', after: '100.00' }],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await mount(
      createElement(PricingBaseEditor, {
        base: '/pricing',
        data,
        initial: { roomTypeId: 't', date: '2036-02-29', planId: 'p' },
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    await fill('#base-amount', '100.00');
    await fill('#base-reason', 'Season correction');
    await click('Preview changes');
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({
      roomTypeIds: ['t'],
      startsOn: '2036-02-29',
      endsOn: '2036-03-01',
      amount: '100.00',
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Review and apply');
  });
  it('does not offer a customer quote for a saved draft or silently select another plan', async () => {
    await mount(
      createElement(PricingPreviewPanel, {
        base: '/pricing',
        data: { ...data, plans: [{ ...plan, lifecycle: 'Draft' }] },
        planId: plan.id,
      }),
    );
    expect(document.body.textContent).toContain('Activate this plan before quoting');
    expect(document.querySelector('button')).toBeNull();
  });
  it('shows an empty setup state instead of a dead explainer', async () => {
    await mount(
      createElement(PricingPreviewPanel, { base: '/pricing', data: { ...data, plans: [] } }),
    );
    expect(document.body.textContent).toContain('Pricing setup required');
    expect(
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent === 'Explain price',
      ),
    ).toBe(false);
  });
});
