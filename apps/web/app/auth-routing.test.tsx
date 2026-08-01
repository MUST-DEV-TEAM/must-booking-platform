import { describe, expect, it } from 'vitest';

import { authDestination, loginPath, type SessionUser } from './auth-routing';

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
