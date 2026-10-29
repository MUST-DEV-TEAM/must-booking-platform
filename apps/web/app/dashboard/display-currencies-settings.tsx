'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  daysSince,
  deviationFromMarket,
  HARD_DEVIATION,
  SOFT_DEVIATION,
  STALE_DAYS,
  worked,
} from './exchange-rate-guidance';
import { inventoryRequest } from './inventory-api';

type Rate = {
  currency: string;
  rate: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string;
};
type Settings = {
  base: string;
  version: string;
  displayCurrencies: string[] | null;
  rates: Rate[];
  /** What the daily feed alone says: hotel-currency units per one unit of each currency. */
  feed?: { date: string | null; perUnit: Record<string, number> };
};
type Change = {
  id: string;
  currency: string;
  oldRate: string | null;
  newRate: string | null;
  changedAt: string;
  changedByName: string;
};
const plain = (value: string | null) => (value === null ? 'feed' : String(Number(value)));

function RateRow({
  currency,
  base,
  rate,
  reference,
  referenceDate,
  enabled,
  disabled,
  onSelect,
  onSave,
  onRemove,
}: {
  currency: string;
  base: string;
  rate?: Rate;
  reference?: number;
  referenceDate?: string | null;
  enabled: boolean;
  disabled: boolean;
  onSelect(enabled: boolean): void;
  onSave(rate: string, confirmOutlier: boolean): void;
  onRemove(): void;
}) {
  const [value, setValue] = useState(rate?.rate ?? '');
  // A second, deliberate click is needed when the typed rate is far from the market.
  const [acknowledged, setAcknowledged] = useState(false);
  const deviation = deviationFromMarket(value, reference);
  const far = deviation !== null && deviation > SOFT_DEVIATION;
  const veryFar = deviation !== null && deviation > HARD_DEVIATION;
  const example = worked(value, base, currency);
  const age = rate ? daysSince(rate.updatedAt) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <Label>
        <Checkbox
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => onSelect(checked === true)}
          aria-label={`Display ${currency}`}
        />
        Display {currency}
        {rate && age >= STALE_DAYS ? (
          <Badge variant="warning">Not reviewed for {age} days</Badge>
        ) : null}
      </Label>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (far && !acknowledged) {
            setAcknowledged(true);
            return;
          }
          onSave(value, veryFar);
          setAcknowledged(false);
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={`fx-${currency}`}>
            1 {currency} in {base}
          </Label>
          <Input
            id={`fx-${currency}`}
            aria-label={`Hotel rate for ${currency}`}
            inputMode="decimal"
            value={value}
            disabled={disabled}
            onChange={(event) => {
              setValue(event.target.value);
              setAcknowledged(false);
            }}
            placeholder="Use daily feed"
          />
        </div>
        <Button type="submit" disabled={disabled || !value}>
          {far && acknowledged ? 'Save anyway' : `Save ${currency} rate`}
        </Button>
        <Button type="button" variant="outline" disabled={disabled || !rate} onClick={onRemove}>
          Use feed for {currency}
        </Button>
      </form>
      {example ? <p className="m-0 text-sm">{example}</p> : null}
      {reference ? (
        <p className="m-0 text-sm text-muted-foreground">
          Market today: 1 {currency} ≈ {reference} {base}
          {referenceDate ? ` (daily feed, ${referenceDate})` : ''}.
        </p>
      ) : null}
      {far ? (
        <Alert variant="warning">
          <AlertDescription>
            {veryFar
              ? `This is ${Math.round((deviation ?? 0) * 100)}% away from the market rate. A rate this far off is usually typed the wrong way round: the field is how many ${base} one ${currency} costs.`
              : `This is ${Math.round((deviation ?? 0) * 100)}% away from the market rate.`}
            {acknowledged ? ' Press Save anyway to keep it.' : ' Press save, then confirm.'}
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="m-0 text-sm text-muted-foreground">
        {rate
          ? `1 ${currency} = ${rate.rate} ${base}. Last changed by ${rate.updatedByName || rate.updatedBy} on ${new Date(rate.updatedAt).toLocaleString()}.`
          : 'Uses the daily feed when a rate is available.'}
      </p>
    </div>
  );
}

export function DisplayCurrenciesSettings({
  tenantId,
  propertyId,
  canWrite,
  refreshKey,
}: {
  tenantId: string;
  propertyId: string;
  canWrite: boolean;
  refreshKey?: string | null;
}) {
  const root = `/api/tenants/${tenantId}/properties/${propertyId}/exchange-rates`;
  const key = ['dashboard', 'display-currencies', tenantId, propertyId, refreshKey];
  const client = useQueryClient();
  const [code, setCode] = useState('');
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const result = await inventoryRequest<Settings>(root);
      if (!result || typeof result.base !== 'string' || !Array.isArray(result.rates))
        throw new Error('Display currencies could not be read.');
      return result;
    },
  });
  const history = useQuery({
    queryKey: [...key, 'changes'],
    queryFn: async () => {
      const result = await inventoryRequest<Change[]>(`${root}/changes?limit=10`);
      return Array.isArray(result) ? result : [];
    },
  });
  const change = useMutation({
    mutationFn: ({ method, path = '', body }: { method: string; path?: string; body?: unknown }) =>
      inventoryRequest(root + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    // The key prefix covers both the settings and their change history.
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const data = query.data;
  const selected = data?.displayCurrencies ?? [];
  const codes = [
    ...new Set([...selected, ...(data?.rates.map((rate) => rate.currency) ?? [])]),
  ].sort();
  const disabled = !canWrite || change.isPending;
  const select = (currencies: string[]) => change.mutate({ method: 'PATCH', body: { currencies } });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Display currencies</CardTitle>
        <CardDescription>
          Approximate prices only, not used for charging. Bookings, payments and refunds keep their
          original amounts and currencies. Enter how many hotel-currency units equal one
          display-currency unit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending ? <p role="status">Loading display currencies...</p> : null}
        {query.isError || change.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {(change.error ?? query.error)?.message ?? 'Display currencies could not be saved.'}
            </AlertDescription>
          </Alert>
        ) : null}
        {change.isSuccess ? <p role="status">Display currencies saved.</p> : null}
        {data ? (
          <>
            <p className="m-0 text-sm">
              Hotel currency: <strong>{data.base}</strong>. A hotel rate overrides the daily feed;
              Use feed removes only that override.
            </p>
            {data.displayCurrencies === null ? (
              <p className="m-0 text-sm text-muted-foreground">
                The website currently uses its Elementor currency choices. Add a currency here to
                manage the website list from these settings.
              </p>
            ) : null}
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                select([...selected, code.toUpperCase()]);
                setCode('');
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="display-currency-code">Extra display currency</Label>
                <Input
                  id="display-currency-code"
                  placeholder="EUR"
                  maxLength={3}
                  value={code}
                  disabled={disabled}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                />
              </div>
              <Button
                type="submit"
                disabled={disabled || !/^[A-Z]{3}$/.test(code) || code === data.base}
              >
                Add display currency
              </Button>
            </form>
            {codes.map((currency) => {
              const rate = data.rates.find((r) => r.currency === currency);
              return (
                <RateRow
                  key={currency + (rate?.updatedAt ?? 'feed')}
                  currency={currency}
                  base={data.base}
                  rate={rate}
                  reference={data.feed?.perUnit[currency]}
                  referenceDate={data.feed?.date}
                  enabled={selected.includes(currency)}
                  disabled={disabled}
                  onSelect={(on) =>
                    select(on ? [...selected, currency] : selected.filter((c) => c !== currency))
                  }
                  onSave={(rate, confirmOutlier) =>
                    change.mutate({
                      method: 'PUT',
                      path: `/${currency}`,
                      body: confirmOutlier ? { rate, confirmOutlier: true } : { rate },
                    })
                  }
                  onRemove={() => change.mutate({ method: 'DELETE', path: `/${currency}` })}
                />
              );
            })}
            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-base font-semibold">Recent rate changes</h3>
              {history.data && history.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.data.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{new Date(entry.changedAt).toLocaleString()}</TableCell>
                        <TableCell>{entry.currency}</TableCell>
                        <TableCell>
                          {plain(entry.oldRate)} → {plain(entry.newRate)} {data.base}
                        </TableCell>
                        <TableCell>{entry.changedByName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">
                  No hotel rate has been changed yet.
                </p>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
