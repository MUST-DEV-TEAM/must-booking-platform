'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../../components/ui/card';
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

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex h-36 items-center justify-center bg-muted/30">
        <UtensilsCrossed aria-hidden="true" className="size-14 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-foreground">Restaurant</span>
          <Badge variant={on ? 'success' : 'secondary'}>
            {status.isPending ? 'Checking…' : status.isError ? 'Unavailable' : on ? 'On' : 'Off'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Take table bookings for your hotel's restaurant: tables, floor map, reservations and
          online booking.
        </p>
        {status.isError ? (
          <p className="text-xs text-destructive">{status.error.message}</p>
        ) : on && !venue?.setupCompletedAt ? (
          <p className="text-xs text-muted-foreground">
            Open Restaurants in the menu to finish the setup.
          </p>
        ) : null}
        {canWrite && available ? (
          on ? (
            <Button
              className="w-full"
              size="sm"
              variant="outline"
              disabled={change.isPending}
              onClick={() => setConfirmingOff(true)}
            >
              Deactivate
            </Button>
          ) : (
            <Button
              className="w-full"
              size="sm"
              variant="outline"
              disabled={change.isPending || status.isPending}
              onClick={() => change.mutate(true)}
            >
              Activate
            </Button>
          )
        ) : null}
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
      </CardContent>
    </Card>
  );
}
