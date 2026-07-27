export type TenantId = string;
export type PropertyId = string;

export interface TenantContext {
  tenantId: TenantId;
}

export interface PropertyContext extends TenantContext {
  propertyId: PropertyId;
}

export interface HealthStatus {
  status: 'ok';
}
