import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

export const PLATFORM_CONSOLE = 'platform-console-controller';
export const PLATFORM_PUBLIC = 'platform-console-public';
export const PLATFORM_AUTHENTICATED = 'platform-console-authenticated';
export const PLATFORM_CAPABILITY = 'platform-console-capability';
export const PLATFORM_AUDIT = 'platform-console-audit';
export const PLATFORM_NO_IDEMPOTENCY = 'platform-console-no-idempotency';

export interface PlatformActor {
  accountId: string;
  email: string;
  name: string | null;
  roleKey: string;
  roleName: string;
  capabilities: readonly string[];
  sessionId: string;
}

/** Per-request facts the console services need; created by PlatformAccessGuard. */
export interface PlatformRequestContext {
  actor: PlatformActor | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  /** Set when a service wrote its own audit row, so the interceptor does not duplicate it. */
  audited: boolean;
  /** Filled by handlers for the fallback audit row (reason, tenant, target, before, after). */
  hint: PlatformAuditHint;
}

export interface PlatformAuditHint {
  tenantId?: string;
  propertyId?: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface PlatformAuditOptions {
  action: string;
  /** Route parameter that carries the hotel id, copied into the audit row. */
  tenantParam?: string;
  targetType?: string;
}

/** Marks a controller as part of the platform console: separate cookie, guard and audit rules. */
export const PlatformConsole = (): ClassDecorator => SetMetadata(PLATFORM_CONSOLE, true);
/** No session needed (login, accepting an invitation). Still subject to the CSRF header rule. */
export const PlatformPublic = (): MethodDecorator => SetMetadata(PLATFORM_PUBLIC, true);
/** Any signed-in platform account may call it (me, logout). */
export const PlatformAuthenticated = (): MethodDecorator =>
  SetMetadata(PLATFORM_AUTHENTICATED, true);
/** The platform capability the caller must hold. A console route without one is denied. */
export const PlatformCapability = (key: string): MethodDecorator =>
  SetMetadata(PLATFORM_CAPABILITY, key);
/** Required on every mutating console route; the interceptor writes the audit row. */
export const PlatformAudit = (action: string, options: Omit<PlatformAuditOptions, 'action'> = {}) =>
  SetMetadata(PLATFORM_AUDIT, { action, ...options } satisfies PlatformAuditOptions);
/** Opt a mutating route out of the Idempotency-Key requirement (login, logout, cookie setters). */
export const PlatformNoIdempotency = (): MethodDecorator =>
  SetMetadata(PLATFORM_NO_IDEMPOTENCY, true);

export const PlatformCtx = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlatformRequestContext => {
    const request = context.switchToHttp().getRequest<{ platformCtx?: PlatformRequestContext }>();
    if (!request.platformCtx) throw new Error('Platform context is missing on a console route.');
    return request.platformCtx;
  },
);

export function requireActor(ctx: PlatformRequestContext): PlatformActor {
  if (!ctx.actor) throw new Error('A platform session is required.');
  return ctx.actor;
}
