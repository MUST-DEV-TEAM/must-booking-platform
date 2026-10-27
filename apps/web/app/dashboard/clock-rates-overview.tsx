'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClockSnapshot } from './clock-sync';
import { inventoryRequest } from './inventory-api';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Switch } from '../../components/ui/switch';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '../../components/ui/table';

export type ClockRate = {
  externalRateId: string;
  /** Clock's own name, for example "BB". */
  name: string;
  /** What guests read, for example "Bed & breakfast". */
  label?: string;
  mealNames?: string[];
  maxAdults?: number | null;
  maxChildren?: number | null;
};

const limit = (value: number | null | undefined, noun: string) =>
  value == null ? `${noun}: not limited in Clock` : `Up to ${value} ${noun}`;

/**
 * Every rate Clock publishes for the booking engine, by room type. Rates and prices live in Clock; staff only
 * decide whether each rate is sold on the hotel's website. Every rate is on by default, and staff booking screens
 * always see every rate.
 */
export function ClockRatesOverview({
  root,
  types,
}: {
  root: string;
  types: { id: string; name: string }[];
}) {
  const parts = root.split('/');
  const tenantId = parts[parts.indexOf('tenants') + 1]!,
    propertyId = parts[parts.indexOf('properties') + 1]!;
  const snapshot = useClockSnapshot<{ roomTypes: Record<string, ClockRate[]> }>(
    tenantId,
    propertyId,
    'rates',
  );
  const client = useQueryClient();
  const hiddenKey = ['dashboard', 'clock-website-rates', tenantId, propertyId];
  const hidden = useQuery({
    queryKey: hiddenKey,
    queryFn: () =>
      inventoryRequest<{ hiddenRateIds: string[] }>(`${root}/clock-website-rates/hidden`),
  });
  const [switchingOff, setSwitchingOff] = useState<{ id: string; label: string } | null>(null);
  const change = useMutation({
    mutationFn: ({ id, onWebsite }: { id: string; onWebsite: boolean }) =>
      inventoryRequest(`${root}/clock-website-rates/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onWebsite }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: hiddenKey }),
  });
  const off = new Set(hidden.data?.hiddenRateIds ?? []);
  const data = snapshot.data?.data?.roomTypes ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rates by room type</CardTitle>
        <CardDescription>
          Every rate Clock publishes for online booking is sold on the website unless you switch it
          off here. Guests see every rate that is on and choose; nothing is chosen for them. Staff
          booking screens always show every rate. Rates and prices are managed in Clock. To see what
          each rate costs for a stay, use “Check selected stay price” above.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="m-0 text-xs text-muted-foreground">
          {snapshot.data?.lastSyncedAt
            ? `Last synchronized ${new Date(snapshot.data.lastSyncedAt).toLocaleString()}`
            : 'Rates are synchronizing automatically.'}
        </p>
        {change.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {change.error instanceof Error
                ? change.error.message
                : 'The rate could not be changed.'}
            </AlertDescription>
          </Alert>
        ) : null}
        {hidden.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              Which rates are switched off could not be read, so the switches below may be wrong.
            </AlertDescription>
          </Alert>
        ) : null}
        {data
          ? types.map((type) => {
              const rates = [...(data[type.id] ?? [])].sort((a, b) =>
                (a.label ?? a.name).localeCompare(b.label ?? b.name),
              );
              const allOff =
                rates.length > 0 && rates.every((rate) => off.has(rate.externalRateId));
              return (
                <div key={type.id} className="flex flex-col gap-2">
                  <p className="m-0 font-semibold">{type.name}</p>
                  {allOff ? (
                    <Alert>
                      <AlertDescription>
                        Every rate of this room type is switched off, so guests cannot book it on
                        the website.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate</TableHead>
                        <TableHead>Meals</TableHead>
                        <TableHead>Guests allowed</TableHead>
                        <TableHead>Sold on website</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rates.map((rate) => {
                        const label = rate.label ?? rate.name;
                        const onWebsite = !off.has(rate.externalRateId);
                        return (
                          <TableRow key={rate.externalRateId}>
                            <TableCell>
                              <span className="font-medium">{label}</span>
                              {rate.label && rate.label !== rate.name ? (
                                <Badge variant="muted" className="ml-2">
                                  {rate.name}
                                </Badge>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {rate.mealNames?.length ? rate.mealNames.join(', ') : 'None included'}
                            </TableCell>
                            <TableCell>
                              {limit(rate.maxAdults, 'adults')};{' '}
                              {limit(rate.maxChildren, 'children')}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={onWebsite}
                                  disabled={hidden.isPending || change.isPending}
                                  aria-label={`Sell ${label} (${type.name}) on the website`}
                                  onCheckedChange={(next) =>
                                    next
                                      ? change.mutate({ id: rate.externalRateId, onWebsite: true })
                                      : setSwitchingOff({ id: rate.externalRateId, label })
                                  }
                                />
                                <span className="text-xs text-muted-foreground">
                                  {onWebsite ? 'On' : 'Off'}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {rates.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4}>
                            No published Clock rates returned for this room type. Check its rate
                            setup in Clock.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              );
            })
          : null}
      </CardContent>
      {switchingOff ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setSwitchingOff(null)}
          title={`Stop selling ${switchingOff.label} on the website?`}
          description="Guests will no longer be offered this rate, and prices shown on the website will ignore it. Bookings already made are not affected, and staff can still book it. You can switch it back on at any time."
          confirmLabel="Switch off"
          onConfirm={async () => {
            await change.mutateAsync({ id: switchingOff.id, onWebsite: false });
            setSwitchingOff(null);
          }}
        />
      ) : null}
    </Card>
  );
}
