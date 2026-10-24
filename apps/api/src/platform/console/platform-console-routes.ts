import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import {
  PLATFORM_AUDIT,
  PLATFORM_AUTHENTICATED,
  PLATFORM_CAPABILITY,
  PLATFORM_CONSOLE,
  PLATFORM_NO_IDEMPOTENCY,
  PLATFORM_PUBLIC,
} from './platform-console.decorators';

export interface ConsoleRoute {
  controller: string;
  handler: string;
  method: keyof typeof RequestMethod;
  path: string;
  mutating: boolean;
  audited: boolean;
  public: boolean;
  authenticatedOnly: boolean;
  capability: string | undefined;
  skipsIdempotency: boolean;
}

/**
 * Every route of every @PlatformConsole() controller, read from decorator metadata. Used by the
 * route-policy test (fails when a mutating route is unaudited or a route has no access rule) and by
 * the end-to-end audit coverage test that calls each mutating route.
 */
export function discoverConsoleRoutes(
  controllers: ReadonlyArray<new (...args: never[]) => unknown>,
): ConsoleRoute[] {
  const routes: ConsoleRoute[] = [];
  for (const controller of controllers) {
    if (!Reflect.getMetadata(PLATFORM_CONSOLE, controller)) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      if (name === 'constructor') continue;
      const handler = controller.prototype[name as keyof typeof controller.prototype] as unknown;
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (method === undefined) continue;
      const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const verb = RequestMethod[method] as keyof typeof RequestMethod;
      routes.push({
        controller: controller.name,
        handler: name,
        method: verb,
        path: '/' + [base, sub === '/' ? '' : sub].filter(Boolean).join('/'),
        mutating: !['GET', 'HEAD', 'OPTIONS'].includes(verb),
        audited: Reflect.getMetadata(PLATFORM_AUDIT, handler) !== undefined,
        public: Reflect.getMetadata(PLATFORM_PUBLIC, handler) === true,
        authenticatedOnly: Reflect.getMetadata(PLATFORM_AUTHENTICATED, handler) === true,
        capability: Reflect.getMetadata(PLATFORM_CAPABILITY, handler) as string | undefined,
        skipsIdempotency: Reflect.getMetadata(PLATFORM_NO_IDEMPOTENCY, handler) === true,
      });
    }
  }
  return routes;
}
