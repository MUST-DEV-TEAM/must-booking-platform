// @vitest-environment jsdom
import { Building2, History } from 'lucide-react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { button, click, mount } from '../../lib/test-dom';
import { PermissionPanel } from './permission-panel';
import { PlatformShell } from './platform-shell';
import { SupportBanner, timeLeft } from './support-banner';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('timeLeft', () => {
  const now = Date.parse('2026-10-20T10:00:00Z');
  it('reads in minutes, then seconds, then expired', () => {
    expect(timeLeft('2026-10-20T10:45:30Z', now)).toBe('45 min left');
    expect(timeLeft('2026-10-20T10:00:20Z', now)).toBe('20 s left');
    expect(timeLeft('2026-10-20T09:59:59Z', now)).toBe('expired');
    expect(timeLeft('not a date', now)).toBe('expired');
  });
});

describe('SupportBanner', () => {
  it('says view-only for a view session and lets the person end it', async () => {
    const onEnd = vi.fn();
    const view = await mount(
      createElement(SupportBanner, {
        kind: 'VIEW',
        who: 'Ana Support',
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        onEnd,
      }),
    );
    expect(view.container.textContent).toContain('Ana Support is viewing this hotel');
    expect(view.container.textContent).toContain('Read-only');
    expect(view.container.querySelector('[data-support-mode="VIEW"]')).not.toBeNull();
    await click(button(view.container, 'End session'));
    expect(onEnd).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it('looks and reads differently for act-as', async () => {
    const act = await mount(
      createElement(SupportBanner, {
        kind: 'ACT',
        who: 'ana@must.al',
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        onEnd: () => undefined,
      }),
    );
    expect(act.container.textContent).toContain('can make limited changes on this hotel’s behalf');
    expect(act.container.textContent).toContain('Every action is recorded');
    expect(act.container.querySelector('[data-support-mode="ACT"]')).not.toBeNull();
    await act.unmount();
  });
});

describe('PlatformShell', () => {
  it('renders the menu with the current page marked, the signed-in role and a sign-out button', async () => {
    const onSignOut = vi.fn();
    const shell = await mount(
      createElement(
        PlatformShell,
        {
          nav: [
            { href: '/platform/hotels', label: 'Hotels', icon: Building2, current: true },
            { href: '/platform/audit', label: 'Audit log', icon: History },
          ],
          user: { name: 'Ana Support', email: 'ana@must.al', roleName: 'Operations / support' },
          onSignOut,
        },
        createElement('p', null, 'Page body'),
      ),
    );
    const current = shell.container.querySelector('a[aria-current="page"]');
    expect(current?.textContent).toBe('Hotels');
    expect(shell.container.textContent).toContain('Operations / support');
    expect(shell.container.textContent).toContain('Page body');
    expect(shell.container.textContent).toContain('not the hotel dashboard');
    await click(button(shell.container, 'Sign out'));
    expect(onSignOut).toHaveBeenCalledOnce();
    await shell.unmount();
  });
});

describe('PermissionPanel', () => {
  it('explains the missing access as an alert', async () => {
    const panel = await mount(createElement(PermissionPanel, {}));
    expect(panel.container.querySelector('[role="alert"]')?.textContent).toContain(
      'You don’t have access to this',
    );
    await panel.unmount();
  });
});
