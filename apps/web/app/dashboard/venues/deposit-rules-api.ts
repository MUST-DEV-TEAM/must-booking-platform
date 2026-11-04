import { venueBase, venueCall } from './venue-api';
export type DepositRule = {
  serviceId: string | null;
  areaId: string | null;
  mode: 'none' | 'per_guest' | 'per_booking';
  amount: string;
  minParty: number;
  freeCancelHours: number;
};
export type DepositRules = {
  version: number;
  currency: string;
  requiresLegacyConversion: boolean;
  rules: DepositRule[];
};
export const depositRulesApi = {
  get: (tenantId: string, venueId: string) =>
    venueCall<DepositRules>('GET', `${venueBase(tenantId, venueId)}/deposit-rules`),
  save: (tenantId: string, venueId: string, input: Pick<DepositRules, 'version' | 'rules'>) =>
    venueCall<DepositRules>('PUT', `${venueBase(tenantId, venueId)}/deposit-rules`, {
      version: input.version,
      rules: input.rules,
    }),
};
