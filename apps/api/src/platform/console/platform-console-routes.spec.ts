import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module';
import { PLATFORM_CAPABILITY_KEYS } from './platform-capabilities';
import { discoverConsoleRoutes } from './platform-console-routes';

const controllers = Reflect.getMetadata('controllers', AppModule) as Array<
  new (...args: never[]) => unknown
>;
const routes = discoverConsoleRoutes(controllers);

describe('platform console route policy', () => {
  it('finds the console routes', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(new Set(routes.map((route) => route.controller)).size).toBeGreaterThanOrEqual(5);
  });

  it('audits every mutating route', () => {
    const unaudited = routes.filter((route) => route.mutating && !route.audited);
    expect(
      unaudited.map((route) => `${route.method} ${route.path} (${route.controller}.${route.handler})`),
    ).toEqual([]);
  });

  it('gives every route an access rule (public, signed-in only, or a known capability)', () => {
    const unguarded = routes.filter(
      (route) => !route.public && !route.authenticatedOnly && !route.capability,
    );
    expect(unguarded.map((route) => `${route.method} ${route.path}`)).toEqual([]);
    const unknown = routes.filter(
      (route) => route.capability && !PLATFORM_CAPABILITY_KEYS.includes(route.capability),
    );
    expect(unknown.map((route) => `${route.method} ${route.path} ${route.capability}`)).toEqual([]);
  });

  it('only lets a few routes skip the Idempotency-Key requirement', () => {
    const skipped = routes
      .filter((route) => route.mutating && route.skipsIdempotency)
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(skipped).toEqual([
      'POST /platform-console/audit/export',
      'POST /platform-console/auth/invitations/accept',
      'POST /platform-console/auth/login',
      'POST /platform-console/auth/logout',
      'POST /platform-console/auth/logout-everywhere',
      'POST /platform-console/support-sessions/:id/enter',
    ]);
  });

  it('never exposes a console route outside the /platform-console prefix', () => {
    expect(routes.every((route) => route.path.startsWith('/platform-console/'))).toBe(true);
  });
});
