import type { BillingProvider, PmsProvider } from '@must/domain-contracts';
import type { HealthStatus } from '@must/shared-types';

export interface ApiContracts {
  billingProvider: BillingProvider;
  healthStatus: HealthStatus;
  pmsProvider: PmsProvider;
}
