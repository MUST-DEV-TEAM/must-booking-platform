// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

import {
  AuthRouteGuard,
  HomeAuthRedirect,
  authDestination,
  loginPath,
  type SessionUser,
} from './auth-routing';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const user = (isPlatformAdmin: boolean): SessionUser => ({
  id: 'user-1',
  email: 'user@example.test',
  emailVerified: true,
  isPlatformAdmin,
});

describe('auth route destination', () => {
  it('routes platform admins to the platform namespace', () => {
    expect(authDestination(user(true))).toBe('/platform');
  });

  it('keeps tenant users on the existing dashboard namespace', () => {
    expect(authDestination(user(false))).toBe('/dashboard');
  });

  it('preserves a safe return path for the matching audience', () => {
    expect(authDestination(user(false), '/dashboard/acme?tab=rooms')).toBe(
      '/dashboard/acme?tab=rooms',
    );
    expect(authDestination(user(true), '/platform?section=tenants')).toBe(
      '/platform?section=tenants',
    );
  });

  it('rejects unsafe or mismatched return paths', () => {
    expect(authDestination(user(false), '/platform?section=tenants')).toBe('/dashboard');
    expect(authDestination(user(true), '//external.example')).toBe('/platform');
  });

  it('builds the session-expired login URL with an encoded return path', () => {
    expect(loginPath('session-expired', '/dashboard/acme?tab=rooms')).toBe(
      '/login?reason=session-expired&returnTo=%2Fdashboard%2Facme%3Ftab%3Drooms',
    );
  });
});

describe('auth route components', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  async function render(component: ReactNode) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(component);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function sessionResponse(isPlatformAdmin: boolean) {
    return {
      ok: true,
      json: async () => ({ user: user(isPlatformAdmin) }),
    };
  }

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    replace.mockReset();
    vi.unstubAllGlobals();
  });

  it('redirects a tenant session away from the platform route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse(false)));
    window.history.replaceState({}, '', '/platform');

    await render(<AuthRouteGuard audience="platform">Platform</AuthRouteGuard>);

    expect(fetch).toHaveBeenCalledWith('/api/auth/session', { credentials: 'include' });
    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('redirects a platform-admin session away from a tenant dashboard route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse(true)));
    window.history.replaceState({}, '', '/dashboard/acme');

    await render(<AuthRouteGuard audience="tenant">Dashboard</AuthRouteGuard>);

    expect(replace).toHaveBeenCalledWith('/platform');
  });

  it('redirects an unauthenticated visitor to login with the requested route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    window.history.replaceState({}, '', '/platform?section=tenants');

    await render(<AuthRouteGuard audience="platform">Platform</AuthRouteGuard>);

    expect(replace).toHaveBeenCalledWith(
      '/login?reason=session-expired&returnTo=%2Fplatform%3Fsection%3Dtenants',
    );
  });

  it('redirects an authenticated home visitor to the matching destination', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse(true)));

    await render(<HomeAuthRedirect>Signup</HomeAuthRedirect>);

    expect(replace).toHaveBeenCalledWith('/platform');
  });
});
