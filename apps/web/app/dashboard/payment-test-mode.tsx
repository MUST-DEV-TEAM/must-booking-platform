'use client';

import { useQuery } from '@tanstack/react-query';

import { TestModeBar } from '../../components/ui/test-mode-bar';
import { settingsAreaHref } from './settings-hub';

const methodNames: Record<string, string> = { POKPAY: 'PokPay', STRIPE: 'Stripe' };

/** The test-mode bar for the selected hotel: shown while a payment method in use is a test account. */
export function PaymentTestMode({
  tenantId,
  propertyId,
  canManage,
}: {
  tenantId: string;
  propertyId: string;
  /** Owners and admins may switch accounts; everyone else only sees the warning. */
  canManage: boolean;
}) {
  const modes = useQuery({
    queryKey: ['dashboard', 'payment-modes', tenantId, propertyId],
    staleTime: 60_000,
    // The bar sits on every dashboard page, so an unexpected answer must hide it, never break the page.
    queryFn: async (): Promise<Array<{ provider: string; mode: string }>> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/payment-modes`,
        { credentials: 'include' },
      );
      if (!response.ok) return [];
      const body: unknown = await response.json().catch(() => null);
      return Array.isArray(body)
        ? body.filter(
            (row): row is { provider: string; mode: string } =>
              typeof row?.provider === 'string' && typeof row?.mode === 'string',
          )
        : [];
    },
  });
  const methods = (modes.data ?? [])
    .filter((row) => row.mode === 'TEST')
    .map((row) => methodNames[row.provider] ?? row.provider);
  return (
    <TestModeBar
      methods={methods}
      manageHref={canManage ? settingsAreaHref(tenantId, propertyId, 'integrations') : undefined}
    />
  );
}
