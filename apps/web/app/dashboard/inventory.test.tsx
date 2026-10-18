// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventorySection, inventoryActions } from './inventory';
import { inventorySelection } from './inventory-selection';
import { InventoryEditor } from './inventory-editor';
import { InventoryPreview } from './inventory-preview';
import { DashboardQueryProvider } from './query-provider';
import type { InventoryRecord } from './inventory-types';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const record: InventoryRecord = {
  id: 'r',
  name: 'Weekend minimum',
  reference: 'RST-2035-0001',
  type: 'minimum_stay',
  value: 3,
  scope: 'property',
  targetIds: [],
  startsOn: '2035-03-01',
  endsOn: null,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  priority: 50,
  lifecycle: 'Draft',
  version: 1,
  validation: 'Healthy',
};
const list = {
  source: 'LOCAL',
  readOnly: false,
  today: '2035-03-01',
  timezone: 'Europe/Tirane',
  items: [record],
  baseRestrictions: [],
};
const overview = {
  source: 'LOCAL',
  today: list.today,
  timezone: list.timezone,
  activeRestrictions: 0,
  activeBlocks: 0,
  countsByType: {},
  needsAttention: [],
  totalNights: 90,
  sellableNights: 84,
  sellablePercentage: 93,
  coverage: [],
};
function fixture(capabilities = ['calendar.view', 'calendar.block'], external = false) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0];
    if (path.endsWith('/capabilities/mine')) return Response.json(capabilities);
    if (path.endsWith('/inventory/restrictions'))
      return Response.json({
        ...list,
        source: external ? 'CLOCK_PMS' : 'LOCAL',
        readOnly: external,
        items: external ? [] : [record],
      });
    if (path.endsWith('/inventory/blocks')) return Response.json({ ...list, items: [] });
    if (path.endsWith('/inventory/overview'))
      return Response.json({
        ...overview,
        ...(external
          ? {
              source: 'CLOCK_PMS',
              totalNights: null,
              sellableNights: null,
              sellablePercentage: null,
              activeRestrictions: null,
              activeBlocks: null,
              coverage: null,
            }
          : {}),
      });
    if (path.endsWith('/inventory/conflicts'))
      return Response.json({
        available: false,
        items: null,
        reason: 'Provider mismatch records are unavailable.',
      });
    if (path.endsWith('/history'))
      return Response.json([
        {
          id: 'audit',
          action: 'inventory_restriction.create',
          createdAt: '2035-03-01T10:00:00Z',
          actorUserId: 'actor',
        },
      ]);
    if (path.endsWith('/room-types')) return Response.json([{ id: 'type', name: 'King' }]);
    if (path.endsWith('/rooms') || path.endsWith('/room-categories') || path.endsWith('/staff'))
      return Response.json([]);
    if (init?.method) return Response.json({ ...record, lifecycle: 'Active', version: 2 });
    throw new Error('Unexpected request: ' + path);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function render(element: ReturnType<typeof createElement>) {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root!.render(createElement(DashboardQueryProvider, undefined, element)));
}
async function wait(text: string) {
  await act(async () => vi.waitFor(() => expect(document.body.textContent).toContain(text)));
}
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;
async function click(text: string) {
  await act(async () => button(text).click());
}
async function fill(id: string, value: string) {
  await act(async () => {
    const input = document.getElementById(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const editorProps = {
  base: '/inventory',
  today: list.today,
  timezone: list.timezone,
  catalog: [{ id: 'type', name: 'King' }],
  categories: [],
  rooms: [],
  staff: null,
  bookingMode: 'ROOM_TYPE_ONLY',
  onClose: vi.fn(),
  onSaved: vi.fn(),
};
describe('Inventory screens', () => {
  it('fails closed before loading inventory if calendar viewing is absent', async () => {
    const fetch = fixture([]);
    await render(
      createElement(InventorySection, { tenantId: 't', propertyId: 'p', emailVerified: true }),
    );
    await wait('Inventory access restricted');
    expect(fetch.mock.calls).toHaveLength(1);
  });
  it('shows overview, directory tools, quick peek and real history', async () => {
    fixture();
    await render(
      createElement(InventorySection, { tenantId: 't', propertyId: 'p', emailVerified: true }),
    );
    await wait('Available room nights');
    expect(document.body.textContent).toContain('93%');
    await click('Restrictions1');
    await wait('Weekend minimum');
    expect(document.querySelector('[aria-label="Columns"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Select all visible records"]')).not.toBeNull();
    await click('Weekend minimumRST-2035-0001');
    await wait('Version 1');
    await click('History');
    await wait('Versioned change recorded.');
  });
  it('shows viewing access without write controls', async () => {
    fixture(['calendar.view']);
    await render(
      createElement(InventorySection, { tenantId: 't', propertyId: 'p', emailVerified: true }),
    );
    await wait('Viewing access only');
    await click('Restrictions1');
    expect(document.body.textContent).not.toContain('Create restriction');
    await click('Weekend minimumRST-2035-0001');
    expect(button('Edit')).toBeUndefined();
    expect(button('Activate')).toBeUndefined();
  });
  it('keeps Clock read-only and shows Unknown instead of a fabricated conflict queue', async () => {
    fixture(['calendar.view', 'calendar.block'], true);
    await render(
      createElement(InventorySection, { tenantId: 't', propertyId: 'p', emailVerified: true }),
    );
    await wait('Clock is the source of availability');
    await click('Restrictions');
    await wait('Clock restrictions Unknown');
    expect(button('Create restriction')).toBeUndefined();
    await click('Conflict Review');
    await wait('Provider conflict review Unknown');
    expect(document.body.textContent).toContain('Provider mismatch records are unavailable.');
    expect(button('Retry validation')).toBeUndefined();
  });
  it('sends version and idempotency key when activation is confirmed', async () => {
    const fetch = fixture();
    await render(
      createElement(InventorySection, { tenantId: 't', propertyId: 'p', emailVerified: true }),
    );
    await wait('Available room nights');
    await click('Restrictions1');
    await click('Weekend minimumRST-2035-0001');
    await wait('Version 1');
    await click('Activate');
    await click('Confirm change');
    await act(async () =>
      vi.waitFor(() =>
        expect(fetch.mock.calls.some(([url]) => url.endsWith('/r/activate'))).toBe(true),
      ),
    );
    const call = fetch.mock.calls.find(([url]) => url.endsWith('/r/activate'))!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ version: 1 });
    expect((call[1]!.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });
  it('requires verified email before offering creation', async () => {
    fixture();
    await render(
      createElement(InventorySection, { tenantId: 't', propertyId: 'p', emailVerified: false }),
    );
    await wait('Verify your email before changing inventory.');
    await click('Restrictions1');
    expect(button('Create restriction')).toBeUndefined();
  });
  it('does not offer editing terminal records and keeps duplicate for archived rules', () => {
    expect(inventoryActions({ ...record, lifecycle: 'Archived' }, 'restrictions')).toEqual([
      { label: 'Duplicate as draft', action: 'duplicate' },
    ]);
    expect(inventoryActions({ ...record, lifecycle: 'Ended' }, 'blocks')).toEqual([]);
  });
});
describe('Inventory editors and preview', () => {
  it('creates a draft with the documented fields and an operation key', async () => {
    const onSaved = vi.fn();
    const fetch = vi.fn().mockResolvedValue(Response.json(record));
    vi.stubGlobal('fetch', fetch);
    await render(createElement(InventoryEditor, { ...editorProps, kind: 'restrictions', onSaved }));
    await fill('inventory-name', 'Draft from editor');
    await click('Save draft');
    await act(async () => vi.waitFor(() => expect(onSaved).toHaveBeenCalled()));
    const request = fetch.mock.calls[0];
    expect(JSON.parse(request[1].body)).toMatchObject({
      name: 'Draft from editor',
      scope: 'property',
      targetIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      endsOn: null,
    });
    expect(request[1].headers['Idempotency-Key']).toBeTruthy();
  });
  it('preserves saved draft and input when activation conflicts', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/validate')
        ? Response.json({ valid: true, errors: [], conflicts: [] })
        : url.endsWith('/activate')
          ? Response.json({ message: 'Conflicting rule' }, { status: 409 })
          : Response.json(record),
    );
    vi.stubGlobal('fetch', fetch);
    await render(createElement(InventoryEditor, { ...editorProps, kind: 'restrictions' }));
    await fill('inventory-name', 'My unsent policy');
    await click('Save and activate');
    await wait('Your draft was saved and is preserved.');
    expect((document.getElementById('inventory-name') as HTMLInputElement).value).toBe(
      'My unsent policy',
    );
    expect(document.body.textContent).toContain('Version 1.');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/inventory/restrictions/validate',
      '/inventory/restrictions',
      '/inventory/restrictions/r/activate',
    ]);
  });
  it('does not create anything when validation fails', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        valid: false,
        errors: [],
        conflicts: [{ id: 'other', name: 'Competing policy' }],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await render(createElement(InventoryEditor, { ...editorProps, kind: 'restrictions' }));
    await fill('inventory-name', 'Conflict candidate');
    await click('Save and activate');
    await wait('Conflicts with Competing policy');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('locks active block scope and sends its version and shortening reason', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ ...record, id: 'b', lifecycle: 'Active', version: 5 }));
    vi.stubGlobal('fetch', fetch);
    await render(
      createElement(InventoryEditor, {
        ...editorProps,
        kind: 'blocks',
        record: {
          ...record,
          id: 'b',
          name: undefined,
          title: 'Repair',
          reason: 'maintenance',
          all: true,
          lifecycle: 'Active',
          scopeLocked: true,
          version: 4,
          endsOn: '2035-03-05',
        },
      }),
    );
    expect(
      document.querySelector<HTMLButtonElement>('[aria-label="Inventory scope"]')?.disabled,
    ).toBe(true);
    expect(document.body.textContent).toContain('Scope is locked');
    await click('Save changes');
    await act(async () => vi.waitFor(() => expect(fetch).toHaveBeenCalled()));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      title: 'Repair',
      version: 4,
      all: true,
      endsOn: '2035-03-05',
      endReason: '',
    });
  });
  it('shows the returned saved-rule preview result', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        booking: {
          valid: false,
          errors: [{ code: 'MIN_STAY', message: 'Three nights required.' }],
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await render(
      createElement(InventoryPreview, {
        base: '/inventory',
        catalog: editorProps.catalog,
        rooms: [],
        today: list.today,
        bookingMode: 'ROOM_TYPE_ONLY',
      }),
    );
    expect(document.body.textContent).toContain('Activate a draft before testing its effect.');
    await fill('preview-departure', '2035-03-02');
    await click('Test stay');
    await wait('Stay rejected');
    expect(document.body.textContent).toContain('Three nights required.');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      roomTypeId: 'type',
      startsOn: '2035-03-01',
      endsOn: '2035-03-02',
      channel: 'staff',
    });
  });
  it.each(['restrictions', 'blocks'] as const)(
    'submits Stock-prefilled %s as a new scoped draft',
    async (kind) => {
      const fetch = fixture();
      await render(
        createElement(InventoryEditor, {
          ...editorProps,
          kind,
          initial: inventorySelection(
            [
              { rowId: 'type', date: '2036-02-29' },
              { rowId: 'type', date: '2036-03-01' },
            ],
            kind,
          )!,
        }),
      );
      await fill(kind === 'restrictions' ? 'inventory-name' : 'inventory-name', 'Grid selection');
      await click('Save draft');
      const call = fetch.mock.calls.find(
        ([url, init]) => String(url) === `/inventory/${kind}` && init?.method === 'POST',
      );
      expect(call).toBeTruthy();
      const init = call![1]!;
      expect(init.headers).toHaveProperty('Idempotency-Key');
      expect(JSON.parse(String(init.body))).toMatchObject({
        startsOn: '2036-02-29',
        endsOn: kind === 'blocks' ? '2036-03-02' : '2036-03-01',
        ...(kind === 'blocks'
          ? { roomTypeIds: ['type'], all: false }
          : { scope: 'room_type', targetIds: ['type'], type: 'stop_sell' }),
      });
    },
  );
});
