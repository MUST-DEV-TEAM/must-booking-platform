'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { IntegrationCard } from '../../../components/ui/integration-card';
import { StatusLine } from '../integration-catalog';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { venueApi } from './venue-api';

/**
 * Settings -> Integrations -> Restaurant. Off until an owner or admin switches it on; switching it
 * off hides Restaurants from the menu but keeps everything that was set up.
 */
export function RestaurantIntegrationCard({
  tenantId,
  propertyId,
  canWrite,
}: {
  tenantId: string;
  propertyId: string;
  canWrite: boolean;
}) {
  const client = useQueryClient();
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const status = useQuery({
    queryKey: ['dashboard', 'restaurant-integration', tenantId, propertyId],
    queryFn: () => venueApi.getRestaurantIntegration(tenantId, propertyId),
  });
  const change = useMutation({
    mutationFn: (on: boolean) => venueApi.setRestaurantIntegration(tenantId, propertyId, on),
    onSuccess: async (result) => {
      // The sidebar and the Restaurants page read the same plan and venue data.
      await client.invalidateQueries({ queryKey: ['dashboard'] });
      await client.invalidateQueries({ queryKey: ['venues', tenantId] });
      toast.success(result.venue?.active ? 'Restaurant switched on' : 'Restaurant switched off');
    },
    onError: (error) => toast.error(error.message),
  });

  const venue = status.data?.venue ?? null;
  const on = venue?.active === true;
  const available = status.data?.available === true;

  const main =
    canWrite && available ? (
      on ? (
        <Button
          size="sm"
          variant="outline"
          disabled={change.isPending}
          onClick={() => setConfirmingOff(true)}
        >
          Deactivate
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={change.isPending || status.isPending}
          onClick={() => change.mutate(true)}
        >
          Activate
        </Button>
      )
    ) : null;

  return (
    <>
      <IntegrationCard
        header={<UtensilsCrossed aria-hidden="true" className="size-14 text-muted-foreground" />}
        title="Restaurant"
        badges={
          <Badge variant={on ? 'success' : 'secondary'}>
            {status.isPending ? 'Checking…' : status.isError ? 'Unavailable' : on ? 'On' : 'Off'}
          </Badge>
        }
        role="Restaurants"
        owns="table bookings, the floor map and reservations"
        health={
          status.isError ? (
            <StatusLine tone="failed">{status.error.message}</StatusLine>
          ) : on ? (
            <StatusLine tone="ok">
              {venue?.setupCompletedAt
                ? 'Set up and taking table bookings'
                : 'Open Restaurants in the menu to finish the setup'}
            </StatusLine>
          ) : (
            <StatusLine tone="idle">{status.isPending ? 'Checking…' : 'Switched off'}</StatusLine>
          )
        }
        footer={
          <>
            <Button
              size="sm"
              variant="outline"
              className={main ? undefined : 'col-span-2'}
              onClick={() => setDetailsOpen(true)}
            >
              Details
            </Button>
            {main}
          </>
        }
      />
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>Restaurant</DialogTitle>
          <DialogDescription>
            Restaurants · owns table bookings, the floor map and reservations
          </DialogDescription>
          <p className="m-0 text-sm">
            Take table bookings for your hotel's restaurant: tables, floor map, reservations and
            online booking.
          </p>
          <p className="m-0 text-sm text-muted-foreground">
            {on
              ? venue?.setupCompletedAt
                ? 'It is on and set up. Manage tables and reservations under Restaurants in the menu.'
                : 'It is on. Open Restaurants in the menu to finish the setup.'
              : 'It is off. Switching it on adds Restaurants to the menu. Switching it off again hides it and keeps everything you set up.'}
          </p>
        </DialogContent>
      </Dialog>
      {confirmingOff ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirmingOff(false)}
          title="Switch off the restaurant?"
          description="Restaurants disappears from the menu and online table booking stops. Everything you set up is kept, and you can switch it back on at any time."
          confirmLabel="Switch off"
          destructive
          onConfirm={async () => {
            await change.mutateAsync(false);
          }}
        />
      ) : null}
    </>
  );
}
