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
};

function RateRow({
  currency,
  base,
  rate,
  enabled,
  disabled,
  onSelect,
  onSave,
  onRemove,
}: {
  currency: string;
  base: string;
  rate?: Rate;
  enabled: boolean;
  disabled: boolean;
  onSelect(enabled: boolean): void;
  onSave(rate: string): void;
  onRemove(): void;
}) {
  const [value, setValue] = useState(rate?.rate ?? '');
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
      </Label>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value);
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
            onChange={(event) => setValue(event.target.value)}
            placeholder="Use daily feed"
          />
        </div>
        <Button type="submit" disabled={disabled || !value}>
          Save {currency} rate
        </Button>
        <Button type="button" variant="outline" disabled={disabled || !rate} onClick={onRemove}>
          Use feed for {currency}
        </Button>
      </form>
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
  const change = useMutation({
    mutationFn: ({ method, path = '', body }: { method: string; path?: string; body?: unknown }) =>
      inventoryRequest(root + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
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
                  enabled={selected.includes(currency)}
                  disabled={disabled}
                  onSelect={(on) =>
                    select(on ? [...selected, currency] : selected.filter((c) => c !== currency))
                  }
                  onSave={(rate) =>
                    change.mutate({ method: 'PUT', path: `/${currency}`, body: { rate } })
                  }
                  onRemove={() => change.mutate({ method: 'DELETE', path: `/${currency}` })}
                />
              );
            })}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
