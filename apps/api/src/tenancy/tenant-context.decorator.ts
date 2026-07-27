import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'public-route';
export const TENANT_SCOPE = 'tenant-scope';

export interface TenantScopeOptions {
  tenantParam?: string;
  propertyParam?: string;
}

export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(PUBLIC_ROUTE, true);
export const TenantScoped = (options: TenantScopeOptions = {}): MethodDecorator =>
  SetMetadata(TENANT_SCOPE, options);
