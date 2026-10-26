// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { button, click, flush, mount } from '../../lib/test-dom';
import { mockConsoleFetch } from '../../lib/test-console';
import { SupportBar } from './support-bar';

const TENANT = '11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation', () => ({ usePathname: () => `/dashboard/${TENANT}/reservations` }));

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const soon = () => new Date(Date.now() + 20 * 60_000).toISOString();
const session = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  tenantId: TENANT,
  hotelName: 'Empire',
  kind: 'VIEW',
  status: 'ACTIVE',
  reason: 'Investigating a double booking',
  requestedBy: { accountId: 'acc-2', email: 'ana@must.al', name: 'Ana Support' },
  expiresAt: soon(),
  ...overrides,
});

describe('SupportBar on the hotel dashboard', () => {
  it('shows who is viewing and until when, and ends the session', async () => {
    const { calls } = mockConsoleFetch({
      'GET /support/current': { active: true, session: session() },
      'POST /support/end': { status: 204 },
    });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const bar = await mount(createElement(SupportBar));
    await flush(4);
    expect(bar.container.textContent).toContain('Ana Support is viewing this hotel');
    expect(bar.container.textContent).toContain('min left');
    // A person in a support session does not also see the owner's approval notices.
    expect(calls.some((call) => call.path.includes('/support-sessions'))).toBe(false);
    await click(button(bar.container, 'End session'));
    await flush(4);
    expect(calls.some((call) => call.method === 'POST' && call.path === '/support/end')).toBe(true);
    expect(assign).toHaveBeenCalledWith(`/platform/hotels/${TENANT}`);
    await bar.unmount();
  });

  it('shows the act-as bar differently', async () => {
    mockConsoleFetch({
      'GET /support/current': { active: true, session: session({ kind: 'ACT' }) },
    });
    const bar = await mount(createElement(SupportBar));
    await flush(4);
    expect(bar.container.querySelector('[data-support-mode="ACT"]')).not.toBeNull();
    expect(bar.container.textContent).toContain('on this hotel’s behalf');
    await bar.unmount();
  });

  it('lets the owner approve or deny an act-as request and see active sessions', async () => {
    let pending = true;
    const { calls } = mockConsoleFetch({
      'GET /support/current': { active: false },
      [`GET /tenants/${TENANT}/support-sessions`]: () => ({
        body: {
          sessions: pending
            ? [session({ id: 's2', kind: 'ACT', status: 'PENDING_APPROVAL' })]
            : [session({ id: 's2', kind: 'ACT', status: 'ACTIVE' })],
        },
      }),
      [`POST /tenants/${TENANT}/support-sessions/s2/approve`]: () => {
        pending = false;
        return { body: { status: 'ACTIVE' } };
      },
    });
    const bar = await mount(createElement(SupportBar));
    await flush(5);
    expect(bar.container.textContent).toContain(
      'MUST support is asking to work in your hotel (Ana Support)',
    );
    expect(bar.container.textContent).toContain(
      'Never billing, staff, credentials, refunds or deletions',
    );
    await click(button(bar.container, 'Approve'));
    await flush(5);
    expect(calls.some((call) => call.path.endsWith('/s2/approve') && call.method === 'POST')).toBe(
      true,
    );
    expect(bar.container.textContent).toContain('MUST support is working in your hotel');
    expect(button(bar.container, 'End their access')).toBeTruthy();
    await bar.unmount();
  });

  it('stays quiet for hotel staff who are not the owner (the owner route answers 403)', async () => {
    mockConsoleFetch({
      'GET /support/current': { active: false },
      [`GET /tenants/${TENANT}/support-sessions`]: () => ({
        status: 403,
        body: { message: 'Insufficient role.' },
      }),
    });
    const bar = await mount(createElement(SupportBar));
    await flush(5);
    expect(bar.container.textContent).toBe('');
    await bar.unmount();
  });
});
