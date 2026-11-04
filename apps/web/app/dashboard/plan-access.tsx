'use client';

import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { PlanAccessProvider } from '../../components/ui/plan-access';

type PlanUsage = {
  plan: { name: string; readOnly: boolean; diningEnabled?: boolean; maxVenues?: number };
  /** `venues` counts the restaurants that are switched on. */
  usage?: { venues?: number };
};

export function usePlanUsage(tenantId: string) {
  return useQuery({
    queryKey: ['dashboard', 'plan-access', tenantId],
    queryFn: async () => {
      const response = await fetch(`/api/tenants/${tenantId}/plan-usage`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Could not check your plan.');
      return (await response.json()) as PlanUsage;
    },
    staleTime: 60_000,
  });
}

/**
 * Tells the dashboard whether the hotel is on a read-only plan. The server refuses every write on
 * such a plan (PLAN_READ_ONLY); this banner explains why, and any write that slips past a disabled
 * button is reported here instead of failing silently.
 */
export function PlanAccessBoundary({
  tenantId,
  children,
}: {
  tenantId: string;
  children: ReactNode;
}) {
  const plan = usePlanUsage(tenantId).data?.plan;
  const readOnly = plan?.readOnly === true;
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (!readOnly) return;
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (response.status === 403) {
        const method = (
          args[1]?.method ?? (args[0] instanceof Request ? args[0].method : 'GET')
        ).toUpperCase();
        if (method !== 'GET') {
          const body = (await response
            .clone()
            .json()
            .catch(() => null)) as { code?: string } | null;
          if (body?.code === 'PLAN_READ_ONLY') setRefused(true);
        }
      }
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, [readOnly]);

  return (
    <PlanAccessProvider value={{ readOnly }}>
      {readOnly ? (
        <div className="px-4 pt-3">
          <Alert variant={refused ? 'destructive' : 'info'} aria-live="polite">
            <Lock aria-hidden="true" />
            <AlertTitle>
              {refused ? 'That change was not saved' : `You are on the ${plan?.name} plan`}
            </AlertTitle>
            <AlertDescription>
              {refused
                ? 'Your plan is read-only. Upgrade your plan to make changes.'
                : 'You can look around every page, but changes are turned off. Upgrade your plan to make changes.'}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {children}
    </PlanAccessProvider>
  );
}
