// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { DashboardStaff } from './staff';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = '/api/tenants/t';
const staff = [
  {
    userId: 'u',
    email: 'staff@test',
    firstName: 'Taylor',
    lastName: 'Staff',
    roleTemplateId: 'a',
    roleTemplateName: 'Front Desk',
    overrides: [],
    status: 'ACTIVE',
    lastActiveAt: '2026-10-10T12:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdByEmail: 'owner@test',
  },
];
const templates = [
  {
    id: 'a',
    name: 'Front Desk',
    kind: 'BUILT_IN',
    capabilities: ['payments.refund'],
    description: null,
    memberCount: 1,
  },
  {
    id: 'b',
    name: 'Finance',
    kind: 'BUILT_IN',
    capabilities: ['payments.refund'],
    description: null,
    memberCount: 0,
  },
  {
    id: 'c',
    name: 'Weekend desk',
    kind: 'CUSTOM',
    capabilities: ['bookings.view'],
    description: 'Limited booking access.',
    memberCount: 2,
  },
];
const catalog = [
  {
    group: 'Payments',
    key: 'payments.refund',
    label: 'Refund payments',
    description: 'Issue payment refunds.',
  },
  {
    group: 'Staff',
    key: 'staff.manage_permissions',
    label: 'Manage staff permissions',
    description: 'Manage staff access.',
  },
  {
    group: 'Staff',
    key: 'staff.suspend',
    label: 'Suspend staff',
    description: 'Suspend or reactivate staff access.',
  },
];
const effectiveCapabilities = [
  { key: 'payments.refund', granted: true, source: 'role' },
  { key: 'staff.manage_permissions', granted: false, source: 'none' },
  { key: 'staff.suspend', granted: true, source: 'role' },
];
const pointerMethods = ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const;
const originalPointerMethods = new Map(
  pointerMethods.map((method) => [
    method,
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, method),
  ]),
);
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
  window.history.replaceState(null, '', '/');
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  for (const method of pointerMethods) {
    const descriptor = originalPointerMethods.get(method);
    if (descriptor) Object.defineProperty(HTMLElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, method);
  }
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

describe('Staff', () => {
  it('invites with the selected role through the hotel-scoped endpoint', async () => {
    const fetch = mock({ staffSeats: 1, maxStaffSeats: 2 });
    const { root } = await mount();

    await clickButton('Add staff');
    await clickTab('Send invitation');
    const email = document.body.querySelector<HTMLInputElement>('#staff-invite-email')!;
    await setValue(email, 'new@test');
    await openSelect('Invite role');
    await chooseOption('Finance');
    await clickButton('Send invitation');

    const request = fetch.mock.calls.find((call) => String(call[0]).endsWith('staff-invitations'))!;
    expect(String(request[0])).toBe(`${base}/properties/p/staff-invitations`);
    expect(request[1]).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect(JSON.parse(request[1]?.body as string)).toEqual({
      email: 'new@test',
      roleTemplateId: 'b',
    });
    expect(toast.success).toHaveBeenCalledWith('Invitation sent.');
    await unmount(root);
  });

  it('sends optional extra permissions with a hotel-scoped invitation', async () => {
    const fetch = mock({ staffSeats: 1, maxStaffSeats: 2 });
    const { root } = await mount();

    await clickButton('Add staff');
    await clickTab('Send invitation');
    await setValue(document.body.querySelector<HTMLInputElement>('#staff-invite-email')!, 'new@test');
    await openMultiSelect('Invitation extra permissions');
    await clickPermission(document.body, 'Manage staff permissions');
    await clickButton('Send invitation');

    const request = fetch.mock.calls.find((call) => String(call[0]).endsWith('staff-invitations'))!;
    expect(String(request[0])).toBe(`${base}/properties/p/staff-invitations`);
    expect(JSON.parse(request[1]?.body as string)).toEqual({
      email: 'new@test',
      roleTemplateId: 'a',
      capabilityKeys: ['staff.manage_permissions'],
    });
    await unmount(root);
  });

  it('creates an account from the contract and offers one copy of the chosen password', async () => {
    const password = 'OwnerChosenPass9!';
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/properties/p/staff') && init?.method === 'POST')
        return Promise.resolve(
          new Response(JSON.stringify({ userId: 'new-user' }), { status: 201 }),
        );
      return responseFor(url);
    });
    vi.stubGlobal('fetch', fetch);
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', { clipboard });
    const { root } = await mount();

    await clickButton('Add staff');
    await setValue(
      document.body.querySelector<HTMLInputElement>('#staff-create-first-name')!,
      'Jordan',
    );
    await setValue(
      document.body.querySelector<HTMLInputElement>('#staff-create-last-name')!,
      'Lee',
    );
    await setValue(
      document.body.querySelector<HTMLInputElement>('#staff-create-email')!,
      'jordan@test',
    );
    await setValue(
      document.body.querySelector<HTMLInputElement>('#staff-create-password')!,
      password,
    );
    await clickButton('Create account');

    const request = fetch.mock.calls.find(
      (call) => String(call[0]).endsWith('/properties/p/staff') && call[1]?.method === 'POST',
    );
    const body = JSON.parse(request?.[1]?.body as string) as Record<string, unknown>;
    expect(
      body.firstName === 'Jordan' && body.lastName === 'Lee' && body.email === 'jordan@test',
    ).toBe(true);
    expect(body.roleTemplateId === 'a' && body.password === password).toBe(true);
    expect(Array.isArray(body.extraCapabilities)).toBe(false);
    expect(document.body.textContent).toContain('Account created for jordan@test.');
    await clickButton('Copy password once');
    expect(clipboard.writeText.mock.calls.length === 1).toBe(true);
    expect(clipboard.writeText.mock.calls[0]?.[0] === password).toBe(true);
    expect(buttonWithText('Copy password once')).toBeUndefined();
    expect(document.body.textContent).not.toContain(password);
    await unmount(root);
  });

  it('copies built-in roles, edits custom roles, and blocks deletion while members remain', async () => {
    let roleRows = [...templates];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? 'GET';
      if (href.endsWith('/role-templates') && method === 'GET')
        return Promise.resolve(new Response(JSON.stringify(roleRows)));
      if (href.endsWith('/role-templates') && method === 'POST') {
        const body = JSON.parse(init?.body as string) as {
          name: string;
          description?: string;
          capabilities: string[];
          copyFromId?: string;
        };
        roleRows = [
          ...roleRows,
          {
            id: 'custom-1',
            name: body.name,
            kind: 'CUSTOM',
            description: body.description ?? null,
            capabilities: body.capabilities,
            memberCount: 0,
          },
        ];
        return Promise.resolve(new Response(JSON.stringify(roleRows.at(-1)), { status: 201 }));
      }
      if (href.endsWith('/role-templates/custom-1') && method === 'PUT') {
        const body = JSON.parse(init?.body as string) as {
          name: string;
          description?: string;
          capabilities: string[];
        };
        roleRows = roleRows.map((role) =>
          role.id === 'custom-1'
            ? { ...role, ...body, description: body.description ?? null }
            : role,
        );
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (href.endsWith('/role-templates/custom-1') && method === 'DELETE') {
        roleRows = roleRows.filter((role) => role.id !== 'custom-1');
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return responseFor(href);
    });
    vi.stubGlobal('fetch', fetch);
    const { root } = await mount();

    await clickTab('Roles');
    expect(document.body.textContent).toContain('2 staff members');
    const lockedRole = cardWithTitle('Front Desk');
    expect(buttonInCard(lockedRole, 'Edit role')).toBeUndefined();
    expect(buttonInCard(lockedRole, 'Copy as custom role')).toBeDefined();
    expect(buttonInCard(cardWithTitle('Weekend desk'), 'Delete role')?.disabled).toBe(true);
    expect(cardWithTitle('Weekend desk').textContent).toContain(
      'Cannot delete while 2 staff members use this role.',
    );

    await clickButton('View permissions');
    expect(document.body.querySelector('[aria-label="Front Desk permissions"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Role');
    expect(
      document.body.querySelector('[role="combobox"][aria-label="Role permissions"]'),
    ).toBeNull();
    await clickButton('Close');

    await clickButton('Copy as custom role');
    await openMultiSelect('Role permissions');
    await clickPermission(document.body, 'Manage staff permissions');
    await setValue(
      document.body.querySelector<HTMLInputElement>('#staff-role-name')!,
      'Front Desk custom',
    );
    await clickButton('Save role');
    const createCall = fetch.mock.calls.find(
      (call) => String(call[0]).endsWith('/role-templates') && call[1]?.method === 'POST',
    );
    const createBody = JSON.parse(createCall?.[1]?.body as string) as {
      name: string;
      capabilities: string[];
      copyFromId?: string;
    };
    expect(createBody.name === 'Front Desk custom' && createBody.copyFromId === 'a').toBe(true);
    expect(createBody.capabilities.includes('payments.refund')).toBe(true);
    expect(createBody.capabilities.includes('staff.manage_permissions')).toBe(true);

    await openButtonInCard(cardWithTitle('Front Desk custom'), 'Edit role');
    await setValue(
      document.body.querySelector<HTMLInputElement>('#staff-role-name')!,
      'Desk custom',
    );
    await clickButton('Save role');
    const updateCall = fetch.mock.calls.find(
      (call) => String(call[0]).endsWith('/role-templates/custom-1') && call[1]?.method === 'PUT',
    );
    const updateBody = JSON.parse(updateCall?.[1]?.body as string) as { name: string };
    expect(updateCall).toBeDefined();
    expect(updateBody.name === 'Desk custom').toBe(true);

    await openButtonInCard(cardWithTitle('Desk custom'), 'Delete role');
    expect(
      fetch.mock.calls.some(
        (call) => String(call[0]).endsWith('/role-templates/c') && call[1]?.method === 'DELETE',
      ),
    ).toBe(false);
    expect(
      fetch.mock.calls.some(
        (call) =>
          String(call[0]).endsWith('/role-templates/custom-1') && call[1]?.method === 'DELETE',
      ),
    ).toBe(true);
    await unmount(root);
  });

  it('shows the shared table controls, status and last active, row quick peek and selection', async () => {
    mock({ staffSeats: 1, maxStaffSeats: 2 });
    const { container, root } = await mount();

    expect(container.querySelector('[aria-label="Select all staff on this page"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Columns"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Compact rows"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Search staff"]')).not.toBeNull();
    expect(container.textContent).toContain('Suspended');
    expect(container.textContent).toContain('Last active');
    expect(container.textContent).toContain('Role');
    expect(container.textContent).toContain('Extra permissions');
    expect(container.textContent).not.toContain('Hotel scope');
    expect(container.textContent).not.toContain('Role template');
    expect(container.textContent).not.toContain('Create role template');
    expect(container.textContent).toContain('Export CSV');
    expect((buttonWithText('Export CSV') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Select staff@test"]')!.click();
      await settle();
    });
    expect(container.textContent).toContain('1 staff selected');
    expect(container.textContent).toContain('Copy emails');

    await act(async () => {
      container.querySelector<HTMLTableRowElement>('tbody tr')!.click();
      await settle();
    });
    expect(document.body.textContent).toContain('Selected hotel');
    expect(document.body.querySelector('a[href*="staffUser=u"]')?.textContent).toContain(
      'Open staff details',
    );
    expect(
      document.body.querySelector('[aria-label="Quick peek effective permissions"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain('Role');
    expect(document.body.textContent).not.toContain('Not granted · None');
    expect(
      document.body.querySelector('[aria-label="Quick peek extra permissions"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector('[aria-label="Quick peek denied permissions"]'),
    ).not.toBeNull();
    await unmount(root);
  });

  it('uses the grouped multi-select for optional extra permissions in Add staff', async () => {
    mock();
    const { root } = await mount();
    await clickButton('Add staff');
    await openMultiSelect('Extra permissions');

    expect(document.body.querySelector('section[aria-label="Payments"]')).not.toBeNull();
    expect(document.body.querySelector('section[aria-label="Staff"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Issue payment refunds.');
    expect(document.body.querySelector('[aria-label="Select all Payments"]')).not.toBeNull();
    await unmount(root);
  });

  it('assigns a role and edits extra and denied permissions from the catalog', async () => {
    window.history.replaceState(null, '', '/dashboard/t?propertyId=p&section=staff&staffUser=u');
    let currentStaff = [...staff];
    let currentEffective = [...effectiveCapabilities];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'PUT' && href.endsWith('/staff/u')) {
        const body = JSON.parse(init!.body as string) as { roleTemplateId: string };
        currentStaff = [
          { ...currentStaff[0]!, roleTemplateId: body.roleTemplateId, roleTemplateName: 'Finance' },
        ];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (href.endsWith('/effective-capabilities'))
        return Promise.resolve(new Response(JSON.stringify(currentEffective)));
      if (href.includes('/staff/u/capabilities/')) {
        const key = href.split('/capabilities/').at(-1)!;
        if (method === 'DELETE') {
          currentStaff = [
            {
              ...currentStaff[0]!,
              overrides: currentStaff[0]!.overrides.filter(
                (override) => override.capabilityKey !== key,
              ),
            },
          ];
          const roleGranted =
            templates
              .find((template) => template.id === currentStaff[0]!.roleTemplateId)
              ?.capabilities.includes(key) ?? false;
          currentEffective = [
            ...currentEffective.filter((permission) => permission.key !== key),
            { key, granted: roleGranted, source: roleGranted ? 'role' : 'none' },
          ];
        } else {
          const body = JSON.parse(init!.body as string) as { granted: boolean };
          currentStaff = [
            {
              ...currentStaff[0]!,
              overrides: [
                ...currentStaff[0]!.overrides.filter((override) => override.capabilityKey !== key),
                { capabilityKey: key, granted: body.granted },
              ],
            },
          ];
          currentEffective = [
            ...currentEffective.filter((permission) => permission.key !== key),
            {
              key,
              granted: body.granted,
              source: body.granted ? 'extra' : 'denied',
            },
          ];
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (href.endsWith('/staff'))
        return Promise.resolve(new Response(JSON.stringify(currentStaff)));
      if (href.endsWith('/role-templates'))
        return Promise.resolve(new Response(JSON.stringify(templates)));
      if (href.endsWith('/plan-usage'))
        return Promise.resolve(
          new Response(JSON.stringify({ plan: { maxStaffSeats: 2 }, usage: { staffSeats: 1 } })),
        );
      if (href.endsWith('/capabilities/catalog'))
        return Promise.resolve(new Response(JSON.stringify(catalog)));
      if (href.endsWith('/capabilities/mine'))
        return Promise.resolve(new Response(JSON.stringify(catalog.map((item) => item.key))));
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetch);
    const { root } = await mount();

    await openSelect('Role for staff@test');
    await chooseOption('Finance');
    expect(currentStaff[0]?.roleTemplateId).toBe('b');
    expect(fetch).toHaveBeenCalledWith(
      `${base}/properties/p/staff/u`,
      expect.objectContaining({ method: 'PUT', credentials: 'include' }),
    );

    await clickTab('Permissions');
    await openMultiSelect('Extra permissions');
    await clickPermission(document.body, 'Manage staff permissions');
    await openMultiSelect('Denied permissions');
    await clickPermission(document.body, 'Refund payments');
    await clickPermission(document.body, 'Refund payments');

    const calls = fetch.mock.calls.filter((call) =>
      String(call[0]).includes('/staff/u/capabilities/'),
    );
    expect(calls.map((call) => call[1]?.method)).toEqual(['PUT', 'PUT', 'DELETE']);
    expect(String(calls[0]?.[0])).toContain('/capabilities/staff.manage_permissions');
    expect(JSON.parse(calls[0]?.[1]?.body as string)).toEqual({ granted: true });
    expect(String(calls[1]?.[0])).toContain('/capabilities/payments.refund');
    expect(JSON.parse(calls[1]?.[1]?.body as string)).toEqual({ granted: false });
    expect(String(calls[2]?.[0])).toContain('/capabilities/payments.refund');
    expect(currentEffective).toContainEqual({
      key: 'payments.refund',
      granted: true,
      source: 'role',
    });
    expect(toast.success).toHaveBeenCalledWith('Capability override updated.');
    await unmount(root);
  });

  it('edits extra and denied permissions from the quick peek through existing override routes', async () => {
    let currentEffective = [...effectiveCapabilities];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? 'GET';
      if (href.endsWith('/effective-capabilities'))
        return Promise.resolve(new Response(JSON.stringify(currentEffective)));
      if (href.includes('/staff/u/capabilities/')) {
        const key = href.split('/capabilities/').at(-1)!;
        if (method === 'DELETE') {
          currentEffective = [
            ...currentEffective.filter((permission) => permission.key !== key),
            { key, granted: false, source: 'none' },
          ];
        } else {
          const body = JSON.parse(init!.body as string) as { granted: boolean };
          currentEffective = [
            ...currentEffective.filter((permission) => permission.key !== key),
            { key, granted: body.granted, source: body.granted ? 'extra' : 'denied' },
          ];
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return responseFor(href);
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    await act(async () => {
      container.querySelector<HTMLTableRowElement>('tbody tr')!.click();
      await settle();
    });
    await openMultiSelect('Quick peek extra permissions');
    await clickPermission(document.body, 'Manage staff permissions');
    await openMultiSelect('Quick peek denied permissions');
    await clickPermission(document.body, 'Refund payments');

    const calls = fetch.mock.calls.filter((call) =>
      String(call[0]).includes('/staff/u/capabilities/'),
    );
    expect(calls.map((call) => call[1]?.method)).toEqual(['PUT', 'PUT']);
    expect(String(calls[0]?.[0])).toContain('/capabilities/staff.manage_permissions');
    expect(JSON.parse(calls[0]?.[1]?.body as string)).toEqual({ granted: true });
    expect(String(calls[1]?.[0])).toContain('/capabilities/payments.refund');
    expect(JSON.parse(calls[1]?.[1]?.body as string)).toEqual({ granted: false });
    await unmount(root);
  });

  it('confirms suspension and reactivation through the staff status contract', async () => {
    let status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE';
    let currentStaff = [...staff];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/status') && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string) as { status: 'ACTIVE' | 'SUSPENDED' };
        status = body.status;
        currentStaff = [{ ...currentStaff[0]!, status }];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (href.endsWith('/staff'))
        return Promise.resolve(new Response(JSON.stringify(currentStaff)));
      return responseFor(url);
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();
    await act(async () => {
      container.querySelector<HTMLTableRowElement>('tbody tr')!.click();
      await settle();
    });
    await clickButton('Suspend access');

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Suspend access for staff@test?');
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(false);
    await clickButton('Suspend staff');
    expect(status).toBe('SUSPENDED');
    expect(fetch).toHaveBeenCalledWith(
      `${base}/properties/p/staff/u/status`,
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ status: 'SUSPENDED' }),
      }),
    );

    await clickTab('Suspended');
    expect(container.textContent).toContain('staff@test');
    await act(async () => {
      container.querySelector<HTMLTableRowElement>('tbody tr')!.click();
      await settle();
    });
    await clickButton('Reactivate access');
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'Reactivate access for staff@test?',
    );
    await clickButton('Reactivate staff');
    expect(status).toBe('ACTIVE');
    expect(fetch).toHaveBeenCalledWith(
      `${base}/properties/p/staff/u/status`,
      expect.objectContaining({ body: JSON.stringify({ status: 'ACTIVE' }) }),
    );
    await unmount(root);
  });

  it('disables invitation at the seat cap and shows a retryable load error', async () => {
    const { container, root } = await mount(mock({ staffSeats: 2, maxStaffSeats: 2 }));
    expect((buttonWithText('Add staff') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain('staff-seat limit has been reached');
    await unmount(root);

    const failedFetch = vi.fn(() => Promise.resolve(new Response('Forbidden', { status: 403 })));
    vi.stubGlobal('fetch', failedFetch);
    const failed = await mount();
    expect(failed.container.textContent).toContain('Staff could not be loaded');
    expect(failed.container.textContent).toContain('Try again');
    await unmount(failed.root);
  });
});

function mock(usage: { staffSeats: number; maxStaffSeats: number }) {
  const fetch = vi.fn((url: string) => responseFor(url, usage));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function responseFor(url: string, usage = { staffSeats: 1, maxStaffSeats: 2 }) {
  return Promise.resolve(
    new Response(
      JSON.stringify(
        url.endsWith('/staff')
          ? staff
          : url.endsWith('/role-templates')
            ? templates
            : url.endsWith('/plan-usage')
              ? {
                  plan: { maxStaffSeats: usage.maxStaffSeats },
                  usage: { staffSeats: usage.staffSeats },
                }
              : url.endsWith('/capabilities/catalog')
                ? catalog
                : url.endsWith('/capabilities/mine')
                  ? catalog.map((item) => item.key)
                  : url.endsWith('/effective-capabilities')
                    ? effectiveCapabilities
                    : { ok: true },
      ),
    ),
  );
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardStaff, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
  await act(async () => settle());
  return { container, root };
}

async function unmount(root: ReturnType<typeof createRoot>) {
  await act(async () => root.unmount());
}

async function settle() {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await Promise.resolve();
  }
}

function buttonWithText(text: string) {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.getAttribute('role') !== 'tab' && button.textContent?.trim() === text,
  );
}

async function clickButton(text: string) {
  await act(async () => {
    buttonWithText(text)!.click();
    await settle();
  });
}

async function setValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  });
}

async function openSelect(label: string) {
  await act(async () => {
    const trigger = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await settle();
  });
}

async function chooseOption(text: string) {
  await act(async () => {
    const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    if (!option) throw new Error(`Option ${text} was not found.`);
    option.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    option.dispatchEvent(
      new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }),
    );
    option.click();
    await settle();
  });
}

async function clickTab(text: string) {
  await act(async () => {
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.includes(text))!
      .click();
    await settle();
  });
}

async function clickPermission(matrix: HTMLElement, label: string) {
  await act(async () => {
    const checkbox = Array.from(
      matrix.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
    ).find((candidate) => candidate.getAttribute('aria-label') === label);
    if (!checkbox) throw new Error(`Permission ${label} was not found.`);
    checkbox.click();
    await settle();
  });
}

async function openMultiSelect(label: string) {
  await act(async () => {
    document.body.querySelector<HTMLElement>(`[role="combobox"][aria-label="${label}"]`)!.click();
    await settle();
  });
}

function cardWithTitle(text: string) {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="card"]')).find(
    (card) => card.textContent?.includes(text),
  )!;
}

function buttonInCard(card: HTMLElement, text: string) {
  return Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === text,
  );
}

async function openButtonInCard(card: HTMLElement, text: string) {
  await act(async () => {
    buttonInCard(card, text)?.click();
    await settle();
  });
}
