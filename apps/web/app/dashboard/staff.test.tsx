// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { DashboardStaff } from './staff';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = '/api/tenants/t';
const staff = [
  { userId: 'u', email: 'staff@test', roleTemplateId: 'a', roleTemplateName: 'A', overrides: [] },
];
const templates = [
  { id: 'a', name: 'A', capabilities: [{ key: 'payments.refund' }] },
  { id: 'b', name: 'B', capabilities: [{ key: 'payments.refund' }] },
];
afterEach(() => vi.unstubAllGlobals());
describe('Staff', () => {
  it('invites with selected template, assigns roles, and writes all override states', async () => {
    const fetch = mock({ staffSeats: 1, maxStaffSeats: 2 });
    const { c, r } = await mount(fetch);
    await value(c.querySelector('input')!, 'x@test');
    await value(c.querySelector('[aria-label="Invite role template"]')!, 'b');
    await click(c, 'Invite staff');
    expect(
      JSON.parse(fetch.mock.calls.find((x) => String(x[0]).endsWith('staff-invitations'))![1].body)
        .assignments[0].roleTemplateId,
    ).toBe('b');
    await value(c.querySelectorAll('select')[1], 'b');
    expect(fetch).toHaveBeenCalledWith(
      `${base}/properties/p/staff/u`,
      expect.objectContaining({ method: 'PUT' }),
    );
    const o = c.querySelector('[aria-label="staff@test payments.refund"]')!;
    await value(o, 'grant');
    await value(o, 'revoke');
    await value(o, 'default');
    const calls = fetch.mock.calls.filter((x) =>
      String(x[0]).includes('/capabilities/payments.refund'),
    );
    expect(calls.map((x) => x[1].method)).toEqual(['PUT', 'PUT', 'DELETE']);
    expect(JSON.parse(calls[0][1].body)).toEqual({ granted: true });
    expect(JSON.parse(calls[1][1].body)).toEqual({ granted: false });
    await act(async () => r.unmount());
  });
  it('creates a role template with a capability subset and assigning it takes effect exactly', async () => {
    let currentStaff = [
      {
        userId: 'u',
        email: 'staff@test',
        roleTemplateId: 'a',
        roleTemplateName: 'A',
        overrides: [],
      },
    ];
    let currentTemplates = [
      { id: 'a', name: 'A', capabilities: [{ key: 'payments.refund' }] },
      {
        id: 'pm',
        name: 'Property Manager',
        capabilities: [
          { key: 'guests.manage' },
          { key: 'reports.view' },
          { key: 'bookings.manage' },
        ],
      },
    ];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'POST' && href.endsWith('/role-templates')) {
        const body = JSON.parse(init!.body as string) as { name: string; capabilityKeys: string[] };
        currentTemplates = [
          ...currentTemplates,
          {
            id: 'custom',
            name: body.name,
            capabilities: body.capabilityKeys.map((key) => ({ key })),
          },
        ];
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }
      if (method === 'PUT' && href.endsWith('/staff/u')) {
        const body = JSON.parse(init!.body as string) as { roleTemplateId: string };
        currentStaff = [{ ...currentStaff[0], roleTemplateId: body.roleTemplateId }];
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }
      if (href.endsWith('/staff'))
        return Promise.resolve(new Response(JSON.stringify(currentStaff)));
      if (href.endsWith('/role-templates'))
        return Promise.resolve(new Response(JSON.stringify(currentTemplates)));
      if (href.endsWith('/plan-usage'))
        return Promise.resolve(
          new Response(JSON.stringify({ plan: { maxStaffSeats: 2 }, usage: { staffSeats: 1 } })),
        );
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });
    vi.stubGlobal('fetch', fetch);
    const { c, r } = await mount(fetch as never);

    await value(c.querySelector('[placeholder="Template name"]')!, 'Finance');
    const checkboxes = Array.from(c.querySelectorAll('input[type="checkbox"]'));
    expect(checkboxes).toHaveLength(3);
    await act(async () => {
      checkboxes[0].click();
      await Promise.resolve();
    });
    await act(async () => {
      checkboxes[1].click();
      await Promise.resolve();
    });
    await click(c, 'Create template');
    expect(currentTemplates.find((t) => t.id === 'custom')).toEqual({
      id: 'custom',
      name: 'Finance',
      capabilities: [{ key: 'guests.manage' }, { key: 'reports.view' }],
    });

    const assignSelect = c.querySelectorAll('select')[1] as HTMLSelectElement;
    await value(assignSelect, 'custom');
    expect(currentStaff[0].roleTemplateId).toBe('custom');

    expect(c.querySelector('[aria-label="staff@test guests.manage"]')).not.toBeNull();
    expect(c.querySelector('[aria-label="staff@test reports.view"]')).not.toBeNull();
    expect(c.querySelector('[aria-label="staff@test bookings.manage"]')).toBeNull();
    expect(c.querySelector('[aria-label="staff@test payments.refund"]')).toBeNull();

    await act(async () => r.unmount());
  });
  it('disables invite at cap', async () => {
    const { c, r } = await mount(mock({ staffSeats: 2, maxStaffSeats: 2 }));
    expect(
      Array.from(c.querySelectorAll('button')).find((x) => x.textContent === 'Invite staff')!
        .disabled,
    ).toBe(true);
    expect(c.textContent).toContain('Upgrade to unlock more staff seats.');
    await act(async () => r.unmount());
  });
});
function mock(u: { staffSeats: number; maxStaffSeats: number }) {
  const f = vi.fn((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          url.endsWith('/staff')
            ? staff
            : url.endsWith('/role-templates')
              ? templates
              : url.endsWith('/plan-usage')
                ? { plan: { maxStaffSeats: u.maxStaffSeats }, usage: { staffSeats: u.staffSeats } }
                : { ok: true },
        ),
      ),
    ),
  );
  vi.stubGlobal('fetch', f);
  return f;
}
async function mount(f?: ReturnType<typeof mock>) {
  if (!f) mock({ staffSeats: 1, maxStaffSeats: 2 });
  const c = document.createElement('div');
  const r = createRoot(c);
  await act(async () => {
    r.render(createElement(DashboardStaff, { tenantId: 't', propertyId: 'p' }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return { c, r };
}
async function value(e: HTMLInputElement | HTMLSelectElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!.call(e, v);
    e.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}
async function click(c: HTMLElement, t: string) {
  await act(async () => {
    Array.from(c.querySelectorAll('button'))
      .find((x) => x.textContent === t)!
      .click();
    await Promise.resolve();
  });
}
