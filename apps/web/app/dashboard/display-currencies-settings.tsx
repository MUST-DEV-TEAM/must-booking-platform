'use client';

import { formatDateTime } from '../../lib/hotel-format';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { MultiSelect } from '../../components/ui/multi-select';
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
} from './exchange-rate-guidance';
import { inventoryRequest } from './inventory-api';

/** The most currencies a hotel can show next to its own. */
export const MAX_DISPLAY_CURRENCIES = 5;

type Rate = {
  currency: string;
  /** Hotel-currency units for ONE unit of this currency (how the server stores it). */
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
type Scope = {
  tenantId: string;
  propertyId: string;
  canWrite: boolean;
  refreshKey?: string | null;
};

const plain = (value: string | null) => (value === null ? 'feed' : String(Number(value)));

const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch {
    return null;
  }
})();
const currencyName = (code: string) => {
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
};
const allCurrencies = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf(
      'currency',
    );
  } catch {
    return [];
  }
};

/**
 * The hotel's display currencies and exchange rates, read and written through the exchange-rates API.
 * The server keeps a rate as "hotel-currency units per one unit of the other currency"; staff see and type
 * it the natural way round, "1 EUR equals 100.50 ALL", so this hook converts at the edges.
 */
export function useDisplayCurrencies({ tenantId, propertyId, refreshKey }: Scope) {
  const root = `/api/tenants/${tenantId}/properties/${propertyId}/exchange-rates`;
  const key = ['dashboard', 'display-currencies', tenantId, propertyId, refreshKey];
  const client = useQueryClient();
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
  return { query, history, change, data, selected };
}

/** "Also show prices in": up to five currencies, shown to guests as "about" amounts. */
export function AlsoShowPrices(scope: Scope) {
  const { query, change, data, selected } = useDisplayCurrencies(scope);
  const options = useMemo(
    () =>
      allCurrencies()
        .filter((code) => code !== data?.base)
        .map((code) => ({
          value: code,
          label: code,
          description: currencyName(code),
          disabled: selected.length >= MAX_DISPLAY_CURRENCIES && !selected.includes(code),
          disabledReason: `You can show up to ${MAX_DISPLAY_CURRENCIES} currencies.`,
        })),
    [data?.base, selected],
  );
  if (query.isPending) return <p role="status">Loading currencies...</p>;
  if (!data)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {query.error?.message ?? 'Currencies could not be read.'}
        </AlertDescription>
      </Alert>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <MultiSelect
            label="Also show prices in"
            value={selected}
            options={options}
            disabled={!scope.canWrite || change.isPending}
            placeholder="No other currency"
            onChange={(next) => {
              if (next.length <= MAX_DISPLAY_CURRENCIES)
                change.mutate({ method: 'PATCH', body: { currencies: next } });
            }}
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {selected.length} of {MAX_DISPLAY_CURRENCIES}
        </span>
      </div>
      {change.isError ? (
        <p role="alert" className="m-0 text-xs font-semibold text-destructive">
          {change.error.message}
        </p>
      ) : (
        <p className="m-0 text-xs text-muted-foreground">
          Shown as &quot;about&quot; amounts. Guests always pay in {data.base}.
        </p>
      )}
    </div>
  );
}

const positive = (text: string) => {
  const number = Number(text.trim().replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : null;
};
/** A rate as shown: two decimals for large ones (100.50), four for small ones (1.0820). */
const shown = (value: number) => (value >= 10 ? value.toFixed(2) : value.toFixed(4));
const ago = (iso: string) => {
  const days = daysSince(iso);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

function RateRow({
  currency,
  base,
  rate,
  reference,
  disabled,
  onSave,
  onRemove,
}: {
  currency: string;
  base: string;
  rate?: Rate;
  /** Today's market value: hotel-currency units per one unit of this currency. */
  reference?: number;
  disabled: boolean;
  onSave(storedRate: string, confirmOutlier: boolean): void;
  onRemove(): void;
}) {
  const initial = rate && Number(rate.rate) > 0 ? shown(1 / Number(rate.rate)) : '';
  const [value, setValue] = useState(initial);
  // A second, deliberate click is needed when the typed rate is far from the market.
  const [acknowledged, setAcknowledged] = useState(false);
  const typed = positive(value);
  const stored = typed === null ? null : (1 / typed).toFixed(8);
  const tooLarge = stored !== null && Number(stored) === 0;
  const dirty = value !== initial;
  // The market warning is for a rate being typed, not for one that is already saved.
  const deviation = !dirty || stored === null ? null : deviationFromMarket(stored, reference);
  const far = deviation !== null && deviation > SOFT_DEVIATION;
  const veryFar = deviation !== null && deviation > HARD_DEVIATION;
  const effective = typed ?? (reference ? 1 / reference : null);
  const age = rate ? daysSince(rate.updatedAt) : 0;
  const save = () => {
    if (stored === null || tooLarge) return;
    if (far && !acknowledged) {
      setAcknowledged(true);
      return;
    }
    onSave(stored, veryFar);
    setAcknowledged(false);
  };
  return (
    <>
      <TableRow>
        <TableCell className="font-semibold">
          {currency} · {currencyName(currency)}
        </TableCell>
        <TableCell>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Input
              aria-label={`1 ${base} equals how many ${currency}`}
              className="w-28 font-mono text-xs"
              inputMode="decimal"
              value={value}
              disabled={disabled}
              placeholder={reference ? shown(1 / reference) : 'Daily feed'}
              onChange={(event) => {
                setValue(event.target.value);
                setAcknowledged(false);
              }}
            />
            {dirty && typed !== null && !tooLarge ? (
              <Button type="submit" size="sm" disabled={disabled}>
                {far && acknowledged ? 'Save anyway' : 'Save'}
              </Button>
            ) : null}
          </form>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {rate ? ago(rate.updatedAt) : 'Daily feed'}
          {rate && age >= STALE_DAYS ? (
            <Badge variant="warning" className="ml-2">
              Not reviewed for {age} days
            </Badge>
          ) : null}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {effective
            ? `120.00 ${base} ≈ ${(120 * effective).toFixed(2)} ${currency}`
            : 'No rate available yet'}
        </TableCell>
      </TableRow>
      {far || tooLarge || rate ? (
        <TableRow className="border-0 hover:bg-transparent">
          <TableCell colSpan={4} className="pt-0">
            {tooLarge ? (
              <p role="alert" className="m-0 text-xs font-semibold text-destructive">
                That rate is too large to store. Check it.
              </p>
            ) : far ? (
              <Alert variant="warning">
                <AlertDescription>
                  {veryFar
                    ? `This is ${Math.round((deviation ?? 0) * 100)}% away from the market rate. A rate this far off is usually typed the wrong way round: the field is how many ${currency} one ${base} buys.`
                    : `This is ${Math.round((deviation ?? 0) * 100)}% away from the market rate.`}
                  {acknowledged ? ' Press Save anyway to keep it.' : ' Press Save, then confirm.'}
                </AlertDescription>
              </Alert>
            ) : rate ? (
              <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                Set by {rate.updatedByName || rate.updatedBy}. It overrides the daily feed
                {reference
                  ? ` (market today: 1 ${base} ≈ ${shown(1 / reference)} ${currency})`
                  : ''}
                .
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  disabled={disabled}
                  onClick={onRemove}
                >
                  Use the daily feed
                </Button>
              </p>
            ) : null}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/** One row per currency shown next to the hotel's own: the rate, when it changed and what guests see. */
export function ExchangeRateTable(scope: Scope) {
  const { query, history, change, data, selected } = useDisplayCurrencies(scope);
  if (!data || selected.length === 0)
    return query.isPending ? null : (
      <p className="m-0 text-sm text-muted-foreground">
        Choose a currency above to set its rate. Prices stay in {data?.base ?? 'the hotel currency'}
        .
      </p>
    );
  const disabled = !scope.canWrite || change.isPending;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Currency</TableHead>
              <TableHead>1 {data.base} equals</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Example shown to guests</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selected.map((currency) => {
              const rate = data.rates.find((r) => r.currency === currency);
              return (
                <RateRow
                  key={currency + (rate?.updatedAt ?? 'feed')}
                  currency={currency}
                  base={data.base}
                  rate={rate}
                  reference={data.feed?.perUnit[currency]}
                  disabled={disabled}
                  onSave={(storedRate, confirmOutlier) =>
                    change.mutate({
                      method: 'PUT',
                      path: `/${currency}`,
                      body: confirmOutlier
                        ? { rate: storedRate, confirmOutlier: true }
                        : { rate: storedRate },
                    })
                  }
                  onRemove={() => change.mutate({ method: 'DELETE', path: `/${currency}` })}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="m-0 text-xs text-muted-foreground">Rates: above 0, up to 6 decimals.</p>
      {change.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{change.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Recent rate changes</summary>
        {history.data && history.data.length > 0 ? (
          <Table className="mt-2">
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
                  <TableCell>{formatDateTime(entry.changedAt)}</TableCell>
                  <TableCell>{entry.currency}</TableCell>
                  <TableCell>
                    {plain(entry.oldRate)} → {plain(entry.newRate)} {data.base} per {entry.currency}
                  </TableCell>
                  <TableCell>{entry.changedByName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="m-0 mt-2 text-muted-foreground">No hotel rate has been changed yet.</p>
        )}
      </details>
    </div>
  );
}
