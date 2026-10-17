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
  it('invites with the selected role template through the existing endpoint', async () => {
    const fetch = mock({ staffSeats: 1, maxStaffSeats: 2 });
    const { root } = await mount();

    await clickButton('Invite staff');
    const email = document.body.querySelector<HTMLInputElement>('#staff-invite-email')!;
    await setValue(email, 'new@test');
    await openSelect('Invite role');
    await chooseOption('Finance');
    await clickButton('Send invitation');

    const request = fetch.mock.calls.find((call) => String(call[0]).endsWith('staff-invitations'))!;
    expect(request[1]).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect(JSON.parse(request[1]?.body as string)).toEqual({
      email: 'new@test',
      assignments: [{ propertyId: 'p', roleTemplateId: 'b' }],
    });
    expect(toast.success).toHaveBeenCalledWith('Invitation sent.');
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
    expect(document.body.textContent).toContain('Staff access for the selected hotel');
    expect(document.body.querySelector('a[href*="staffUser=u"]')?.textContent).toContain(
      'Open staff details',
    );
    await unmount(root);
  });

  it('assigns a role and writes grant, deny and default extra permissions on the detail page', async () => {
    window.history.replaceState(null, '', '/dashboard/t?propertyId=p&section=staff&staffUser=u');
    let currentStaff = [...staff];
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
      if (href.includes('/capabilities/payments.refund')) {
        if (method === 'DELETE') {
          currentStaff = [
            {
              ...currentStaff[0]!,
              overrides: currentStaff[0]!.overrides.filter(
                (override) => override.capabilityKey !== 'payments.refund',
              ),
            },
          ];
        } else {
          const body = JSON.parse(init!.body as string) as { granted: boolean };
          currentStaff = [
            {
              ...currentStaff[0]!,
              overrides: [{ capabilityKey: 'payments.refund', granted: body.granted }],
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

    await clickTab('Extra permissions');
    const override = document.body.querySelector<HTMLElement>(
      '[aria-label="staff@test payments.refund"]',
    )!;
    await openSelect('staff@test payments.refund');
    await chooseOption('Explicitly granted');
    await openSelect('staff@test payments.refund');
    await chooseOption('Explicitly revoked');
    await openSelect('staff@test payments.refund');
    await chooseOption('Template default');

    const calls = fetch.mock.calls.filter((call) =>
      String(call[0]).includes('/capabilities/payments.refund'),
    );
    expect(calls.map((call) => call[1]?.method)).toEqual(['PUT', 'PUT', 'DELETE']);
    expect(JSON.parse(calls[0]?.[1]?.body as string)).toEqual({ granted: true });
    expect(JSON.parse(calls[1]?.[1]?.body as string)).toEqual({ granted: false });
    expect(override).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Capability override updated.');
    await unmount(root);
  });

  it('opens a suspend dialog that explains the missing operation and cannot submit', async () => {
    const fetch = mock({ staffSeats: 1, maxStaffSeats: 2 });
    const { container, root } = await mount();
    await act(async () => {
      container.querySelector<HTMLTableRowElement>('tbody tr')!.click();
      await settle();
    });
    await clickButton('Suspend access');

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('cannot suspend accounts or revoke sessions');
    expect(buttonWithText('Suspension unavailable')?.hasAttribute('disabled')).toBe(true);
    expect(fetch.mock.calls.some((call) => String(call[0]).includes('/suspend'))).toBe(false);
    await unmount(root);
  });

  it('disables invitation at the seat cap and shows a retryable load error', async () => {
    const { container, root } = await mount(mock({ staffSeats: 2, maxStaffSeats: 2 }));
    expect((buttonWithText('Invite staff') as HTMLButtonElement).disabled).toBe(true);
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
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
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
                : { ok: true },
        ),
      ),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
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
    (button) => button.textContent?.trim() === text,
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
