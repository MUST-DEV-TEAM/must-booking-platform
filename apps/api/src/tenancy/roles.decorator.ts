import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES = 'required-roles';

export enum Role {
  PlatformAdmin = 'PLATFORM_ADMIN',
  TenantOwner = 'TENANT_OWNER',
  TenantAdmin = 'TENANT_ADMIN',
  PropertyStaff = 'PROPERTY_STAFF',
}

export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);
