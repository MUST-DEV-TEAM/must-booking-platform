import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'public-route';
export const TENANT_SCOPE = 'tenant-scope';
export const PUBLIC_TENANT_SCOPE = 'public-tenant-scope';
export const ALLOW_ON_READ_ONLY_PLAN = 'allow-on-read-only-plan';

export interface TenantScopeOptions {
  tenantParam?: string;
  propertyParam?: string;
}

export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(PUBLIC_ROUTE, true);
export const TenantScoped = (options: TenantScopeOptions = {}): MethodDecorator =>
  SetMetadata(TENANT_SCOPE, options);
export const PublicTenantScoped = (options: TenantScopeOptions = {}): MethodDecorator =>
  SetMetadata(PUBLIC_TENANT_SCOPE, options);

/**
 * Marks a write that stays available on a read-only plan: personal state (notification read marks,
 * the user's own email preferences) and side-effect-free checks that use POST.
 */
export const AllowOnReadOnlyPlan = (): MethodDecorator =>
  SetMetadata(ALLOW_ON_READ_ONLY_PLAN, true);
