'use client';
import { HotelMoney } from './approximate-money';
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
import { StatTile } from '../../components/ui/stat-tile';
import { Switch } from '../../components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../components/ui/select';
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
  requiresCode?: boolean;
  onWebsite?: boolean;
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

const idsOf = (root: string) => {
  const parts = root.split('/');
  return {
    tenantId: parts[parts.indexOf('tenants') + 1]!,
    propertyId: parts[parts.indexOf('properties') + 1]!,
  };
};

/** The rates Clock publishes and which of them staff switched off for the website. */
function useClockRates(root: string) {
  const { tenantId, propertyId } = idsOf(root);
  const snapshot = useClockSnapshot<{ roomTypes: Record<string, ClockRate[]> }>(
    tenantId,
    propertyId,
    'rates',
  );
  const hidden = useQuery({
    queryKey: ['dashboard', 'clock-website-rates', tenantId, propertyId],
    queryFn: () =>
      inventoryRequest<{ hiddenRateIds: string[] }>(`${root}/clock-website-rates/hidden`),
  });
  return { snapshot, hidden, off: new Set(hidden.data?.hiddenRateIds ?? []) };
}

const sampleDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
    new Date(`${iso}T00:00:00`),
  );

type SamplePrices = {
  startsOn: string | null;
  endsOn: string | null;
  adults: number;
  nights: number;
  roomTypes: Record<string, Array<{ rateId: string; total: { amount: string; currency: string } }>>;
};

/** What each rate costs for one fixed sample stay, read from Clock a few minutes at a time. */
function useSamplePrices(root: string) {
  const { tenantId, propertyId } = idsOf(root);
  return useQuery({
    queryKey: ['dashboard', 'clock-sample-prices', tenantId, propertyId],
    queryFn: () => inventoryRequest<SamplePrices>(`${root}/clock-sample-prices`),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

const STALE_AFTER_MS = 2 * 60 * 60_000;

/** The four numbers at the top of Rates & Pricing for a hotel connected to Clock. */
export function ClockOverviewTiles({
  root,
  types,
}: {
  root: string;
  types: { id: string; name: string }[];
}) {
  const { snapshot, hidden, off } = useClockRates(root);
  const rates = snapshot.data?.data?.roomTypes ?? null;
  const all = rates ? types.flatMap((type) => rates[type.id] ?? []) : [];
  const soldOnline = all.filter((rate) => !off.has(rate.externalRateId)).length;
  const bookableTypes = rates
    ? types.filter((type) => (rates[type.id] ?? []).some((rate) => !off.has(rate.externalRateId)))
        .length
    : 0;
  const synced = snapshot.data?.lastSyncedAt ? new Date(snapshot.data.lastSyncedAt) : null;
  const stale = !synced || Date.now() - synced.getTime() > STALE_AFTER_MS;
  const ready = !!rates && !hidden.isPending;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Rates sold on the website"
        value={ready ? `${soldOnline} of ${all.length}` : '…'}
        note="Every rate Clock publishes for online booking, unless switched off below."
      />
      <StatTile
        label="Room types bookable online"
        value={ready ? `${bookableTypes} of ${types.length}` : '…'}
        tone={ready && bookableTypes < types.length ? 'warning' : 'default'}
        note="Room types with at least one rate on."
      />
      <StatTile
        label="Rates switched off"
        value={ready ? all.length - soldOnline : '…'}
        tone={ready && all.length - soldOnline > 0 ? 'warning' : 'default'}
        note="Guests cannot book these on the website; staff still can."
      />
      <StatTile
        label="Last synced with Clock"
        size="sm"
        value={synced ? synced.toLocaleString() : 'Not yet'}
        tone={stale ? 'warning' : 'default'}
        note={
          stale
            ? 'Older than two hours or never synced: check the Clock connection.'
            : 'Up to date.'
        }
      />
    </div>
  );
}

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
  const { tenantId, propertyId } = idsOf(root);
  const { snapshot, hidden, off } = useClockRates(root);
  const sample = useSamplePrices(root);
  const caps = useQuery({
    queryKey: ['dashboard', 'pricing-access', tenantId, propertyId],
    queryFn: () => inventoryRequest<string[]>(`${root}/capabilities/mine`),
  });
  const canManage = Array.isArray(caps.data) && caps.data.includes('rates.manage');
  const pairsKey = ['dashboard', 'clock-rate-pairs', tenantId, propertyId];
  const pairs = useQuery({
    queryKey: pairsKey,
    queryFn: () => inventoryRequest<{ pairs: Record<string, string> }>(`${root}/clock-rate-pairs`),
    enabled: canManage,
  });
  // Use the current catalogue for the select: older rate snapshots may lack code-protection metadata.
  const currentRates = useQuery({
    queryKey: ['dashboard', 'clock-pair-options', tenantId, propertyId],
    queryFn: () =>
      inventoryRequest<{ roomTypes: Record<string, ClockRate[]> }>(`${root}/clock-website-rates`),
    enabled: canManage,
  });
  const client = useQueryClient();
  const hiddenKey = ['dashboard', 'clock-website-rates', tenantId, propertyId];
  const [switchingOff, setSwitchingOff] = useState<{ id: string; label: string } | null>(null);
  const change = useMutation({
    mutationFn: ({ id, onWebsite }: { id: string; onWebsite: boolean }) =>
      inventoryRequest(`${root}/clock-website-rates/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onWebsite }),
      }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: hiddenKey }),
        client.invalidateQueries({
          queryKey: ['dashboard', 'clock-pair-options', tenantId, propertyId],
        }),
      ]),
  });
  const pairChange = useMutation({
    mutationFn: ({ id, compareRateId }: { id: string; compareRateId: string | null }) =>
      inventoryRequest(`${root}/clock-rate-pairs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compareRateId }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: pairsKey }),
  });
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
        <p className="m-0 text-sm text-muted-foreground" role="status">
          {sample.isPending
            ? 'Reading sample prices from Clock…'
            : sample.data?.startsOn && sample.data.endsOn
              ? `Sample stay for the prices below: ${sample.data.adults} adults, ${sample.data.nights} nights, ${sampleDate(sample.data.startsOn)} to ${sampleDate(sample.data.endsOn)}. It is the nearest stay with a free room. A price is only a sample, not a quote.`
              : sample.isError
                ? 'Sample prices could not be read from Clock right now.'
                : 'No sample prices: none of the nearest stays has a free room.'}
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
        {pairChange.isSuccess ? <p role="status">Comparison saved.</p> : null}
        {pairChange.isError || pairs.isError || currentRates.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {pairChange.error instanceof Error
                ? pairChange.error.message
                : 'Rate comparisons could not be read. Try again.'}
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
                        <TableHead>Sample price</TableHead>
                        <TableHead>Sold on website</TableHead>
                        <TableHead>Compare with</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rates.map((rate) => {
                        const label = rate.label ?? rate.name;
                        const onWebsite = !off.has(rate.externalRateId);
                        const samplePrice = sample.data?.roomTypes?.[type.id]?.find(
                          (offer) => offer.rateId === rate.externalRateId,
                        )?.total;
                        const compareId = pairs.data?.pairs[rate.externalRateId];
                        const candidates = (currentRates.data?.roomTypes?.[type.id] ?? []).filter(
                          (other) =>
                            other.externalRateId !== rate.externalRateId &&
                            other.onWebsite === true &&
                            !off.has(other.externalRateId) &&
                            !other.requiresCode,
                        );
                        const comparison = candidates.find(
                          (other) => other.externalRateId === compareId,
                        );
                        const comparedPrice = comparison
                          ? sample.data?.roomTypes?.[type.id]?.find(
                              (offer) => offer.rateId === compareId,
                            )?.total
                          : undefined;
                        const showCompared =
                          samplePrice &&
                          comparedPrice &&
                          samplePrice.currency === comparedPrice.currency &&
                          Number(comparedPrice.amount) > Number(samplePrice.amount);
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
                              {sample.isPending ? (
                                '…'
                              ) : samplePrice ? (
                                <HotelMoney
                                  tenantId={tenantId}
                                  propertyId={propertyId}
                                  {...samplePrice}
                                />
                              ) : sample.data?.startsOn ? (
                                'Not bookable then'
                              ) : (
                                '—'
                              )}
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
                            <TableCell>
                              <Select
                                value={compareId ?? 'none'}
                                disabled={
                                  !canManage ||
                                  !pairs.data ||
                                  !currentRates.data ||
                                  pairs.isError ||
                                  currentRates.isError ||
                                  hidden.isPending ||
                                  hidden.isError ||
                                  pairChange.isPending
                                }
                                onValueChange={(value) => {
                                  pairChange.reset();
                                  pairChange.mutate({
                                    id: rate.externalRateId,
                                    compareRateId: value === 'none' ? null : value,
                                  });
                                }}
                              >
                                <SelectTrigger
                                  aria-label={`Compare ${rate.name} (${type.name}) with`}
                                >
                                  <SelectValue>
                                    {compareId
                                      ? (comparison?.name ?? 'Comparison unavailable')
                                      : 'None'}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  {candidates.map((other) => (
                                    <SelectItem
                                      key={other.externalRateId}
                                      value={other.externalRateId}
                                    >
                                      {other.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {compareId && samplePrice ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {showCompared ? (
                                    <>
                                      Guests will see{' '}
                                      <HotelMoney
                                        tenantId={tenantId}
                                        propertyId={propertyId}
                                        {...comparedPrice}
                                      />{' '}
                                      crossed out next to{' '}
                                      <HotelMoney
                                        tenantId={tenantId}
                                        propertyId={propertyId}
                                        {...samplePrice}
                                      />
                                    </>
                                  ) : (
                                    'No crossed-out price for the sample stay'
                                  )}
                                </p>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {rates.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6}>
                            No published Clock rates returned for this room type. Check its rate
                            setup in Clock.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                  <p className="m-0 text-xs text-muted-foreground">
                    Compare with a public rate of the same room type to show its higher price
                    crossed out for the same stay; otherwise the included discount is used.
                  </p>
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
