// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { button, click, flush, mount, type } from '../../lib/test-dom';
import {
  auditor,
  finance,
  mockConsoleFetch,
  superAdmin,
  withQueries,
} from '../../lib/test-console';
import { ConsoleFrame, ConsoleSessionProvider } from './(console)/console-frame';
import AuditPage from './(console)/audit/page';
import HotelsPage from './(console)/hotels/page';
import { HotelDetailView } from './(console)/hotels/[id]/hotel-detail';
import PlatformLoginPage from './login/page';
import TeamPage from './(console)/team/page';
import type { HotelDetail, HotelDirectory } from '../../lib/platform-api';

const replace = vi.fn();
const push = vi.fn();
let pathname = '/platform/hotels';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => pathname,
  useParams: () => ({ id: 'hotel-1' }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  pathname = '/platform/hotels';
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const directory = (overrides: Partial<HotelDirectory> = {}): HotelDirectory => ({
  items: [
    {
      id: 'hotel-1',
      name: 'Empire Beach Resort',
      lifecycleState: 'ACTIVE',
      ownerEmail: 'owner@empire.al',
      ownerPending: false,
      mode: 'CLOCK',
      country: 'AL',
      planName: 'Free',
      propertyCount: 1,
      staffCount: 4,
      bookingCount: 120,
      lastBookingAt: null,
      createdAt: '2026-01-05T10:00:00Z',
      health: null,
    },
    {
      id: 'hotel-2',
      name: 'Sea Breeze',
      lifecycleState: 'TRIAL',
      ownerEmail: 'new@seabreeze.al',
      ownerPending: true,
      mode: 'MUST_SOURCE',
      country: 'AL',
      planName: 'Free',
      propertyCount: 1,
      staffCount: 0,
      bookingCount: 0,
      lastBookingAt: null,
      createdAt: '2026-10-18T10:00:00Z',
      health: null,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
  lifecycleCounts: { TRIAL: 1, ACTIVE: 1, PAST_DUE: 0, SUSPENDED: 0, CANCELLED: 0, ARCHIVED: 0 },
  ...overrides,
});

const detail = (overrides: Partial<HotelDetail> = {}): HotelDetail => ({
  id: 'hotel-1',
  name: 'Empire Beach Resort',
  lifecycle: {
    state: 'ACTIVE',
    label: 'Active',
    reason: 'Contract signed',
    changedAt: '2026-02-01T10:00:00Z',
    version: 3,
    allowedTransitions: ['PAST_DUE', 'SUSPENDED', 'CANCELLED'],
    history: [
      {
        id: 'ev-1',
        from: 'TRIAL',
        to: 'ACTIVE',
        reason: 'Contract signed',
        actorEmail: 'root@must.al',
        createdAt: '2026-02-01T10:00:00Z',
      },
    ],
  },
  mode: 'CLOCK',
  country: 'AL',
  timeZone: 'Europe/Tirane',
  currency: 'EUR',
  createdAt: '2026-01-05T10:00:00Z',
  owner: { email: 'owner@empire.al', name: 'Olga Owner', since: '2026-01-06T10:00:00Z' },
  ownerInvite: null,
  contacts: [
    {
      id: 'p1',
      name: 'Empire Beach',
      address: 'Durres',
      timezone: 'Europe/Tirane',
      phone: null,
      supportEmail: 'info@empire.al',
    },
  ],
  counts: {
    properties: 1,
    staff: 4,
    bookings: 120,
    bookingsLast30Days: 14,
    rooms: 40,
    roomTypes: 5,
  },
  plan: {
    name: 'Free',
    maxProperties: 1,
    maxStaffSeats: 3,
    pmsEnabled: false,
    note: 'Plan and billing are managed in Milestone 15; this is read-only.',
  },
  ...overrides,
});

const checklist = {
  items: [
    {
      key: 'owner_invited',
      label: 'Owner invited',
      state: 'done',
      evidence: 'owner@empire.al is the owner.',
      fixHref: '/x',
    },
    {
      key: 'website',
      label: 'Website connected',
      state: 'todo',
      evidence: 'No website address and no plugin connection yet.',
      fixHref: '/platform/hotels/hotel-1?tab=connections',
    },
  ],
  complete: false,
};

describe('platform sign-in page', () => {
  it('posts the credentials with the console header, no idempotency key, and goes to the console', async () => {
    const { calls } = mockConsoleFetch({ 'POST /auth/login': { me: superAdmin } });
    const page = await mount(createElement(PlatformLoginPage));
    await type(page.container.querySelector('#console-email')!, 'root@must.al');
    await type(page.container.querySelector('#console-password')!, 'Secret-pass-1234');
    await click(button(page.container, 'Sign in'));
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/auth/login',
      body: { email: 'root@must.al' },
    });
    expect(calls[0]!.headers['X-Platform-Console']).toBe('1');
    expect(calls[0]!.headers['Idempotency-Key']).toBeUndefined();
    expect(replace).toHaveBeenCalledWith('/platform');
    await page.unmount();
  });

  it('shows a plain error for a wrong password and a wait message when throttled', async () => {
    let status = 401;
    mockConsoleFetch({
      'POST /auth/login': () => ({ status, body: { message: 'Invalid email or password.' } }),
    });
    const page = await mount(createElement(PlatformLoginPage));
    await type(page.container.querySelector('#console-email')!, 'root@must.al');
    await type(page.container.querySelector('#console-password')!, 'wrong');
    await click(button(page.container, 'Sign in'));
    await flush();
    expect(page.container.textContent).toContain('Incorrect email or password.');
    status = 429;
    await click(button(page.container, 'Sign in'));
    await flush();
    expect(page.container.textContent).toContain('Too many sign-in attempts');
    expect(replace).not.toHaveBeenCalled();
    await page.unmount();
  });

  it('asks for both fields before calling the server', async () => {
    const { calls } = mockConsoleFetch({});
    const page = await mount(createElement(PlatformLoginPage));
    await click(button(page.container, 'Sign in'));
    expect(page.container.textContent).toContain('Enter your email and password.');
    expect(calls).toHaveLength(0);
    await page.unmount();
  });
});

describe('console frame', () => {
  it('sends a signed-out visitor to the sign-in page and keeps where they were going', async () => {
    mockConsoleFetch({
      'GET /auth/me': () => ({
        status: 401,
        body: { message: 'A valid platform session is required.' },
      }),
    });
    const frame = await mount(
      withQueries(createElement(ConsoleFrame, null, createElement('p', null, 'secret'))),
    );
    await flush(5);
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('/platform/login?returnTo='));
    expect(frame.container.textContent).not.toContain('secret');
    await frame.unmount();
  });

  it('shows only the menu entries the role allows', async () => {
    mockConsoleFetch({ 'GET /auth/me': { me: finance } });
    const frame = await mount(
      withQueries(createElement(ConsoleFrame, null, createElement('p', null, 'body'))),
    );
    await flush(5);
    const labels = [...frame.container.querySelectorAll('nav a')].map((a) => a.textContent);
    expect(labels).toEqual(['Overview', 'Hotels']);
    expect(frame.container.textContent).toContain('Finance');
    await frame.unmount();

    mockConsoleFetch({ 'GET /auth/me': { me: superAdmin } });
    const full = await mount(
      withQueries(createElement(ConsoleFrame, null, createElement('p', null, 'body'))),
    );
    await flush(5);
    expect([...full.container.querySelectorAll('nav a')].map((a) => a.textContent)).toEqual([
      'Overview',
      'Hotels',
      'Support access',
      'Team',
      'Audit log',
    ]);
    await full.unmount();
  });

  it('signs out through the API and returns to the sign-in page', async () => {
    const { calls } = mockConsoleFetch({
      'GET /auth/me': { me: auditor },
      'POST /auth/logout': { status: 204 },
    });
    const frame = await mount(
      withQueries(createElement(ConsoleFrame, null, createElement('p', null, 'body'))),
    );
    await flush(5);
    await click(button(frame.container, 'Sign out'));
    await flush(3);
    expect(calls.some((call) => call.method === 'POST' && call.path === '/auth/logout')).toBe(true);
    expect(replace).toHaveBeenCalledWith('/platform/login');
    await frame.unmount();
  });
});

describe('hotel directory', () => {
  const page = async (me = superAdmin) =>
    mount(withQueries(createElement(ConsoleSessionProvider, { me }, createElement(HotelsPage))));

  it('lists hotels with status, mode, owner, invited owner and placeholder plan and health', async () => {
    mockConsoleFetch({ 'GET /hotels': directory() });
    const view = await page();
    await flush(4);
    const text = view.container.textContent ?? '';
    expect(text).toContain('Empire Beach Resort');
    expect(text).toContain('Clock PMS');
    expect(text).toContain('owner@empire.al');
    expect(text).toContain('Invited');
    expect(text).toContain('Not scored yet');
    expect(view.container.querySelector('a[href="/platform/hotels/hotel-1"]')).not.toBeNull();
    expect(view.container.querySelector('a[href="/platform/hotels/new"]')).not.toBeNull();
    await view.unmount();
  });

  it('filters by status from the tiles and shows removable chips', async () => {
    const { calls } = mockConsoleFetch({ 'GET /hotels': directory() });
    const view = await page();
    await flush(4);
    const trial = [...view.container.querySelectorAll('button[aria-pressed]')].find((node) =>
      node.textContent?.startsWith('Trial'),
    )!;
    await click(trial);
    await flush(4);
    expect(calls.at(-1)!.path).toBe('/hotels');
    expect(view.container.textContent).toContain('Status: Trial');
    await click(button(view.container, 'Remove filter Status: Trial'));
    await flush(3);
    expect(view.container.textContent).not.toContain('Status: Trial');
    await view.unmount();
  });

  it('shows the empty state, the no-results state and an error with a reference', async () => {
    mockConsoleFetch({
      'GET /hotels': directory({
        items: [],
        total: 0,
        lifecycleCounts: {
          TRIAL: 0,
          ACTIVE: 0,
          PAST_DUE: 0,
          SUSPENDED: 0,
          CANCELLED: 0,
          ARCHIVED: 0,
        },
      }),
    });
    const empty = await page();
    await flush(4);
    expect(empty.container.textContent).toContain('No hotels yet');
    await empty.unmount();

    mockConsoleFetch({ 'GET /hotels': directory({ items: [], total: 0 }) });
    const none = await page();
    await flush(4);
    expect(none.container.textContent).toContain('No results');
    await none.unmount();

    mockConsoleFetch({ 'GET /hotels': () => ({ status: 500, body: { message: 'boom' } }) });
    const broken = await page();
    await flush(6);
    expect(broken.container.querySelector('[role="alert"]')?.textContent).toContain('req-test-1');
    await broken.unmount();
  });

  it('hides Add hotel from roles that cannot create, and denies a role without hotel access', async () => {
    mockConsoleFetch({ 'GET /hotels': directory() });
    const readOnly = await page(auditor);
    await flush(4);
    expect(readOnly.container.querySelector('a[href="/platform/hotels/new"]')).toBeNull();
    await readOnly.unmount();

    const denied = await page({ ...auditor, capabilities: [] });
    expect(denied.container.querySelector('[role="alert"]')?.textContent).toContain(
      'You don’t have access',
    );
    await denied.unmount();
  });
});

describe('hotel detail', () => {
  const routes = (data = detail()) => ({
    'GET /hotels/hotel-1': data,
    'GET /hotels/hotel-1/onboarding': checklist,
    'GET /support-sessions': { sessions: [] },
  });
  const page = (me = superAdmin) =>
    mount(
      withQueries(createElement(ConsoleSessionProvider, { me }, createElement(HotelDetailView))),
    );

  it('shows status, owner, history and an onboarding checklist with evidence and a fix link', async () => {
    mockConsoleFetch(routes());
    const view = await page();
    await flush(6);
    const text = view.container.textContent ?? '';
    expect(text).toContain('Empire Beach Resort');
    expect(text).toContain('Olga Owner');
    expect(text).toContain('Trial → Active');
    expect(text).toContain('1 of 2 done');
    expect(text).toContain('No website address and no plugin connection yet.');
    expect(
      view.container.querySelector('a[href="/platform/hotels/hotel-1?tab=connections"]'),
    ).not.toBeNull();
    expect(text).toContain('Plan and billing are managed in Milestone 15');
    await view.unmount();
  });

  it('changes status only after a reason is given, and sends the version it saw', async () => {
    const { calls } = mockConsoleFetch({
      ...routes(),
      'POST /hotels/hotel-1/lifecycle': { tenantId: 'hotel-1', state: 'PAST_DUE', version: 4 },
    });
    const view = await page();
    await flush(6);
    await click(button(view.container, 'Change status'));
    const menuItem = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (n) => n.textContent === 'Move to Past due',
    )!;
    await click(menuItem);
    await flush();
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Move Empire Beach Resort to Past due?');
    const confirm = button(dialog, 'Move to Past due');
    expect(confirm.disabled).toBe(true);
    await type(dialog.querySelector('textarea')!, 'Invoice 114 unpaid');
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    await flush(4);
    const post = calls.find(
      (call) => call.method === 'POST' && call.path === '/hotels/hotel-1/lifecycle',
    )!;
    expect(post.body).toEqual({ to: 'PAST_DUE', reason: 'Invoice 114 unpaid', version: 3 });
    expect(post.headers['Idempotency-Key']).toBeTruthy();
    await view.unmount();
  });

  it('requires typing the word for serious moves such as cancelling', async () => {
    mockConsoleFetch(routes());
    const view = await page();
    await flush(6);
    await click(button(view.container, 'Change status'));
    await click(
      [...document.body.querySelectorAll('[role="menuitem"]')].find(
        (n) => n.textContent === 'Move to Cancelled',
      )!,
    );
    await flush();
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]')!;
    await type(dialog.querySelector('textarea')!, 'Owner asked to close');
    const confirm = button(dialog, 'Move to Cancelled');
    expect(confirm.disabled).toBe(true);
    await type(dialog.querySelector('input')!, 'CANCELLED');
    expect(confirm.disabled).toBe(false);
    await view.unmount();
  });

  it('offers no status change to a role that cannot change it', async () => {
    mockConsoleFetch(
      routes(detail({ lifecycle: { ...detail().lifecycle, allowedTransitions: [] } })),
    );
    const view = await page(auditor);
    await flush(6);
    expect(
      [...view.container.querySelectorAll('button')].some((b) =>
        b.textContent?.includes('Change status'),
      ),
    ).toBe(false);
    expect(view.container.textContent).not.toContain('Open as support');
    await view.unmount();
  });

  it('shows invite owner when there is no owner, and a not-found panel for an unknown hotel', async () => {
    mockConsoleFetch(
      routes(
        detail({
          owner: null,
          ownerInvite: { email: 'new@seabreeze.al', invitedAt: '2026-10-18T10:00:00Z' },
        }),
      ),
    );
    const view = await page();
    await flush(6);
    expect(view.container.textContent).toContain('Re-invite owner');
    expect(view.container.textContent).toContain('new@seabreeze.al');
    await view.unmount();

    mockConsoleFetch({
      'GET /hotels/hotel-1': () => ({ status: 404, body: { message: 'Hotel not found.' } }),
    });
    const missing = await page();
    await flush(6);
    expect(missing.container.textContent).toContain('Hotel not found');
    await missing.unmount();
  });

  it('requires a reason of at least ten characters before opening a support session', async () => {
    const { calls } = mockConsoleFetch(routes());
    const view = await page();
    await flush(6);
    await click(button(view.container, 'Open as support'));
    await flush(3);
    const dialog = document.body.querySelector('[role="dialog"]')!;
    await click(button(dialog, 'Start viewing'));
    expect(dialog.textContent).toContain('Explain why in at least 10 characters.');
    expect(calls.some((call) => call.path === '/support-sessions' && call.method === 'POST')).toBe(
      false,
    );
    await view.unmount();
  });
});

describe('direct owner-level access (temporary)', () => {
  const directAdmin = {
    ...superAdmin,
    capabilities: [...superAdmin.capabilities, 'platform.support.direct'],
  };

  it('enters at once with no reason, and sends the banner choice', async () => {
    const { calls } = mockConsoleFetch({
      'GET /hotels/hotel-1': detail(),
      'GET /hotels/hotel-1/onboarding': checklist,
      'GET /support-sessions': { sessions: [] },
      'POST /support-sessions': {
        status: 201,
        body: { id: 's-1', status: 'ACTIVE', kind: 'ACT', direct: true, showBanner: false },
      },
      'POST /support-sessions/s-1/enter': { dashboardPath: '/dashboard/hotel-1' },
    });
    const view = await mount(
      withQueries(
        createElement(ConsoleSessionProvider, { me: directAdmin }, createElement(HotelDetailView)),
      ),
    );
    await flush(6);
    await click(button(view.container, 'Open as support'));
    await flush(3);
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Enter as the hotel owner');
    await click(dialog.querySelector('[aria-label="Show the support banner while I am inside"]')!);
    await click(button(dialog, 'Enter now'));
    await flush(4);
    const post = calls.find((call) => call.path === '/support-sessions' && call.method === 'POST');
    expect(post?.body).toMatchObject({ direct: true, showBanner: false, reason: '' });
    expect(dialog.textContent).not.toContain('Explain why');
    await view.unmount();
  });
});

describe('team page', () => {
  const members = {
    members: [
      {
        id: 'acc-1',
        email: 'root@must.al',
        name: 'Rea Root',
        roleKey: 'super_admin',
        roleName: 'Super admin',
        status: 'ACTIVE',
        lastLoginAt: new Date().toISOString(),
        createdAt: '2026-01-01T00:00:00Z',
        version: 0,
        invitationExpiresAt: null,
      },
      {
        id: 'acc-2',
        email: 'ops@must.al',
        name: null,
        roleKey: 'operations',
        roleName: 'Operations / support',
        status: 'INVITED',
        lastLoginAt: null,
        createdAt: '2026-10-01T00:00:00Z',
        version: 0,
        invitationExpiresAt: '2026-10-25T00:00:00Z',
      },
    ],
  };
  const roles = {
    roles: [
      {
        id: 'r1',
        key: 'super_admin',
        name: 'Super admin',
        description: 'Everything.',
        isBuiltIn: true,
        capabilities: ['platform.team.manage'],
      },
    ],
    catalog: [
      { group: 'Team', key: 'platform.team.manage', label: 'Manage the team', description: '' },
    ],
  };

  it('lists people with status and roles, marks you, and explains each role', async () => {
    mockConsoleFetch({ 'GET /team': members, 'GET /team/roles': roles });
    const view = await mount(
      withQueries(
        createElement(ConsoleSessionProvider, { me: superAdmin }, createElement(TeamPage)),
      ),
    );
    await flush(5);
    const text = view.container.textContent ?? '';
    expect(text).toContain('Rea Root');
    expect(text).toContain('You');
    expect(text).toContain('Invited');
    expect(text).toContain('Manage the team');
    expect(button(view.container, 'Add team member')).toBeTruthy();
    await view.unmount();
  });

  it('is read-only for the auditor (no add button, no row actions)', async () => {
    mockConsoleFetch({ 'GET /team': members, 'GET /team/roles': roles });
    const view = await mount(
      withQueries(createElement(ConsoleSessionProvider, { me: auditor }, createElement(TeamPage))),
    );
    await flush(5);
    expect(
      [...view.container.querySelectorAll('button')].some((b) =>
        b.textContent?.includes('Add team member'),
      ),
    ).toBe(false);
    expect(view.container.querySelector('button[aria-label^="Actions for"]')).toBeNull();
    await view.unmount();
  });

  it('denies finance', async () => {
    mockConsoleFetch({});
    const view = await mount(
      withQueries(createElement(ConsoleSessionProvider, { me: finance }, createElement(TeamPage))),
    );
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      'You don’t have access',
    );
    await view.unmount();
  });
});

describe('audit page', () => {
  const rows = {
    items: [
      {
        id: 'a1',
        createdAt: '2026-10-19T10:00:00Z',
        actorEmail: 'root@must.al',
        actorRole: 'super_admin',
        action: 'platform.hotel.lifecycle_changed',
        tenantId: 'hotel-1',
        tenantName: 'Empire Beach Resort',
        targetType: 'organization',
        targetId: 'hotel-1',
        before: { state: 'ACTIVE' },
        after: { state: 'SUSPENDED' },
        reason: 'Unpaid',
        result: 'succeeded',
        ip: '10.0.0.1',
        requestId: 'req-9',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 50,
  };

  it('shows who did what to which hotel, with before and after in a details dialog', async () => {
    mockConsoleFetch({ 'GET /audit': rows, 'GET /hotels': directory() });
    const view = await mount(
      withQueries(
        createElement(ConsoleSessionProvider, { me: superAdmin }, createElement(AuditPage)),
      ),
    );
    await flush(5);
    expect(view.container.textContent).toContain('Hotel status changed');
    expect(view.container.textContent).toContain('Empire Beach Resort');
    await click(button(view.container, 'Details'));
    await flush();
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Unpaid');
    expect(dialog.textContent).toContain('SUSPENDED');
    expect(dialog.textContent).toContain('req-9');
    await view.unmount();
  });

  it('offers export only with the export permission and denies finance entirely', async () => {
    mockConsoleFetch({ 'GET /audit': rows, 'GET /hotels': directory() });
    const view = await mount(
      withQueries(createElement(ConsoleSessionProvider, { me: auditor }, createElement(AuditPage))),
    );
    await flush(5);
    expect(
      [...view.container.querySelectorAll('button')].some((b) =>
        b.textContent?.includes('Export CSV'),
      ),
    ).toBe(false);
    await view.unmount();

    const denied = await mount(
      withQueries(createElement(ConsoleSessionProvider, { me: finance }, createElement(AuditPage))),
    );
    expect(denied.container.querySelector('[role="alert"]')?.textContent).toContain(
      'You don’t have access',
    );
    await denied.unmount();
  });
});
