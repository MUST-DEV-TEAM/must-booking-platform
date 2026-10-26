// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityAudit } from './activity-audit';
import type { AuditEvent, AuditPage } from '../../lib/activity-audit';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= Observer as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
const event: AuditEvent = {
  id: 'e-1',
  action: 'inventory_units.bulk_change',
  family: 'Inventory',
  result: 'Succeeded',
  critical: false,
  createdAt: '2026-10-19T10:00:00Z',
  actorUserId: 'owner-id',
  actor: 'Recorded Operator',
  targetType: 'room_type',
  targetId: 'type-1',
  before: { stock: 5 },
  after: { stock: 7 },
  reason: 'Stock update',
  details: { before: { stock: 5 }, after: { stock: 7 } },
  requestContext: { requestId: 'request-1', method: 'PUT', route: '/inventory-units' },
  related: [],
};
const page = (overrides: Partial<AuditPage> = {}): AuditPage => ({
  items: [event],
  page: 1,
  pageSize: 25,
  total: 1,
  counts: { today: 1, critical: 0, uniqueActors: 1 },
  actors: [{ id: 'owner-id', label: 'Recorded Operator' }],
  families: ['Inventory', 'Rates'],
  canViewActors: true,
  canExport: true,
  version: 0,
  through: '2026-10-19T11:00:00Z',
  filters: {
    from: '2026-09-20',
    to: '2026-10-19',
    search: '',
    family: '',
    actor: '',
    target: '',
    result: '',
  },
  scopeKey: 'permitted-scope',
  ...overrides,
});
const roots: Root[] = [];
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ActivityAudit, { tenantId: 't', propertyId: 'p' }),
      ),
    );
    await settle();
  });
  await act(settle);
  return client;
}
const button = (text: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found) throw new Error('Missing button ' + text);
  return found;
};
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
    await settle();
  });
};
function fixture(overrides: Partial<AuditPage> = {}, detail: AuditEvent = event) {
  let version = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      version++;
      return Response.json({
        csv: '\uFEFF"Evidence"\r\n"e-1"',
        count: 1,
        version,
        evidenceId: 'export-evidence',
        filename: 'audit.csv',
      });
    }
    return Response.json(url.endsWith('/e-1') ? detail : page({ ...overrides, version }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
describe('property audit evidence workspace', () => {
  it('uses the full shared directory and opens recorded before/after/context in a side panel', async () => {
    fixture();
    await mount();
    expect(document.body.textContent).toContain('Critical events');
    expect(document.querySelector('[aria-label="Columns"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Compact rows"]')).not.toBeNull();
    expect(
      document.querySelector('[aria-label="Select inventory_units.bulk_change"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain('Copy selected');
    expect(document.body.textContent).not.toContain('Export page CSV');
    await click(button(event.action));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('pre[aria-label="Before (recorded)"]')?.textContent).toContain(
      '5',
    );
    expect(document.querySelector('pre[aria-label="After (recorded)"]')?.textContent).toContain(
      '7',
    );
    expect(document.body.textContent).toContain('request-1');
  });
  it('shows absent evidence as Not recorded rather than inventing a snapshot', async () => {
    fixture(
      {},
      { ...event, before: null, after: null, requestContext: null, result: 'Not recorded' },
    );
    await mount();
    await click(button(event.action));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Outcome not specified',
    );
    for (const title of ['Before (recorded)', 'After (recorded)', 'Request context (recorded)'])
      expect(document.querySelector(`pre[aria-label="${title}"]`)).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'No field-by-field change was saved',
    );
  });
  it('confirms a server-audited filtered export with the exact version/cutoff and downloads BOM CSV', async () => {
    const fetch = fixture(),
      create = vi.fn(() => 'blob:audit');
    Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await mount();
    await click(button('Export filtered CSV'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('5,000');
    await click(button('Create audited CSV'));
    const write = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(write[0]).toBe('/api/tenants/t/properties/p/activity-audit/export');
    expect(JSON.parse(write[1]!.body as string)).toEqual({
      version: 0,
      through: page().through,
      filters: page().filters,
    });
    expect((write[1]!.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    expect(create).toHaveBeenCalled();
    expect(document.body.textContent).toContain('Exported 1 recorded events');
    expect(document.body.textContent).toContain('export-evidence');
  });
  it('exports selected server IDs without a local unaudited export', async () => {
    const fetch = fixture();
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => 'blob:audit',
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await mount();
    await click(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Select inventory_units.bulk_change"]',
      )!,
    );
    await click(button('Export selected CSV'));
    await click(button('Create audited CSV'));
    const write = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(write[1]!.body as string).ids).toEqual(['e-1']);
  });
  it('keeps view access but disables all export commands for an unverified account', async () => {
    fixture({ canExport: false });
    await mount();
    expect(document.body.textContent).toContain('Verify your email');
    expect(button('Export filtered CSV').disabled).toBe(true);
    await click(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Select inventory_units.bulk_change"]',
      )!,
    );
    expect(button('Export selected CSV').disabled).toBe(true);
  });
  it('shows limited actor context and sends server-wide search rather than filtering another page locally', async () => {
    const fetch = fixture({
      canViewActors: false,
      actors: [],
      items: [{ ...event, actorUserId: null, actor: 'Hidden (requires staff.view)' }],
    });
    await mount();
    expect(document.body.textContent).not.toContain('Recorded Operator');
    expect(document.body.textContent).toContain('Required permission: staff.view');
    expect(document.querySelector('[aria-label="Actor"]')).toBeNull();
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search audit log"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'inventory',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    });
    expect(fetch.mock.calls.some(([url]) => url.includes('search=inventory'))).toBe(true);
  });
  it('shows empty, request-reference failure and permission-denied states without fabricated counters', async () => {
    fixture({ items: [], total: 0, counts: { today: 0, critical: 0, uniqueActors: 0 } });
    const client = await mount();
    expect(document.body.textContent).toContain('No recorded audit events match these filters');
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('{"message":"Missing audit access"}', {
          status: 403,
          headers: { 'x-request-id': 'audit-ref' },
        }),
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['activity-audit'] });
      await settle();
    });
    expect(document.body.textContent).toContain('Audit access denied');
    expect(document.body.textContent).toContain('audit-ref');
    expect(button('Export filtered CSV').disabled).toBe(true);
  });
  it('hides a cached detail when current audit access is revoked', async () => {
    fixture();
    const client = await mount();
    await click(button(event.action));
    expect(document.body.textContent).toContain('Recorded Operator');
    vi.stubGlobal(
      'fetch',
      async () => new Response('{"message":"Access revoked"}', { status: 403 }),
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['activity-audit'] });
      await settle();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
      'Recorded Operator',
    );
    expect(document.querySelector('pre')).toBeNull();
  });
});

it('shows readable outcomes, saved field changes and an explicitly linked operation timeline', async () => {
  const detailed: AuditEvent = {
    ...event,
    title: 'Stay changed',
    source: 'Staff in MUST',
    operationId: 'amend:1',
    result: 'Not recorded',
    details: {
      changes: {
        endsOn: { old: '2028-04-13', new: '2028-04-14' },
        total: { old: '1000.00', new: '1250.00' },
      },
    },
    linked: [
      { ...event, id: 'linked', title: 'Payment received', result: 'Succeeded', source: 'PokPay' },
    ],
  };
  fixture({ items: [detailed] }, detailed);
  await mount();
  expect(document.body.textContent).toContain('Outcome not specified');
  expect(document.body.textContent).toContain('Staff in MUST');
  await click(button('Stay changed'));
  expect(document.querySelector('table[aria-label="Recorded changes"]')?.textContent).toContain(
    'Check-out',
  );
  expect(document.querySelector('table[aria-label="Recorded changes"]')?.textContent).toContain(
    '1250.00',
  );
  expect(document.querySelector('section[aria-label="Operation timeline"]')?.textContent).toContain(
    'Payment received',
  );
  expect(document.querySelector('section[aria-label="Operation timeline"]')?.textContent).toContain(
    'Completed',
  );
});
it('requests separate business and routine system views without losing the server filters', async () => {
  const fetcher = fixture();
  await mount();
  expect(String(fetcher.mock.calls[0][0])).toContain('view=business');
  await click(button('Routine system activity'));
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('view=system'))).toBe(true);
  await click(button('All activity'));
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('view=all'))).toBe(true);
});
