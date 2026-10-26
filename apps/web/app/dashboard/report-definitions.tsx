'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '../../components/ui/dialog';
import { MetricDefinitions, type MetricDefinition } from '../../components/ui/metric-definitions';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';

type Definitions = { timezone: string; basis: string; definitions: MetricDefinition[] };

export function ReportDefinitions({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['report-definitions', tenantId, propertyId],
    enabled: open,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/reports/definitions`,
        { credentials: 'include' },
      );
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? 'Reports permission is required.'
            : `Unable to load definitions. Reference: ${response.headers.get('x-request-id') ?? response.status}`,
        );
      return (await response.json()) as Definitions;
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Definitions</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Report definitions</DialogTitle>
          <DialogDescription>
            Metric formulas, date basis and known limits. Definitions do not imply that every report
            is already available.
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <ListSkeleton rows={3} />
        ) : query.isError ? (
          <ErrorPanel
            title="Definitions unavailable"
            description={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <MetricDefinitions {...query.data} />
        )}
      </DialogContent>
    </Dialog>
  );
}
