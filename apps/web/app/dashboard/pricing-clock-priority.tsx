'use client';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '../../components/ui/table';
import { inventoryRequest } from './inventory-api';
type Rate = {
  externalRateId: string;
  name: string;
  rank: number | null;
  maxAdults?: number | null;
  maxChildren?: number | null;
};
/** Existing MUST-owned Clock preference: changes only local priority, never the provider's prices. */
export function ClockPricingPriority({
  root,
  canWrite,
  types,
}: {
  root: string;
  canWrite: boolean;
  types: { id: string; name: string }[];
}) {
  const [data, setData] = useState<Record<string, Rate[]> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clock rates by room type</CardTitle>
        <CardDescription>
          Only the preferred order is stored in MUST. Prices and rate definitions remain managed in
          Clock. Listed rates are published to the booking engine. Date and stay restrictions are
          checked separately for each quote.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              setData(
                (
                  await inventoryRequest<{ roomTypes: Record<string, Rate[]> }>(
                    `${root}/clock-rate-ranking`,
                  )
                ).roomTypes,
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Clock rate list could not be loaded.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Load Clock rate list
        </Button>
        {data
          ? types.map((t) => (
              <div key={t.id} className="flex flex-col gap-2">
                <p className="m-0 font-semibold">{t.name}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider rate</TableHead>
                      <TableHead>Guest limits</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data[t.id] ?? []).map((r, i) => (
                      <TableRow key={r.externalRateId}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>
                          {r.maxAdults == null
                            ? 'Adults: not supplied'
                            : `Up to ${r.maxAdults} adults`}
                          ;{' '}
                          {r.maxChildren == null
                            ? 'children: not supplied'
                            : `up to ${r.maxChildren} children`}
                        </TableCell>
                        <TableCell>{r.rank === null ? 'Not yet ranked' : i + 1}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canWrite || busy || i === 0}
                            onClick={() => {
                              const rates = [...data[t.id]!];
                              [rates[i - 1], rates[i]] = [rates[i]!, rates[i - 1]!];
                              setData({ ...data, [t.id]: rates });
                              setSuccess('');
                            }}
                          >
                            Move up
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canWrite || busy || i === (data[t.id]?.length ?? 0) - 1}
                            onClick={() => {
                              const rates = [...data[t.id]!];
                              [rates[i + 1], rates[i]] = [rates[i]!, rates[i + 1]!];
                              setData({ ...data, [t.id]: rates });
                              setSuccess('');
                            }}
                          >
                            Move down
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(data[t.id] ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          No published Clock rates returned for this room type. Check its rate setup
                          in Clock.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
                {canWrite && (data[t.id]?.length ?? 0) > 0 ? (
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const result = await inventoryRequest<{ rates: Rate[] }>(
                          `${root}/room-types/${t.id}/clock-rate-ranking`,
                          {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              externalRateIds: data[t.id]!.map((r) => r.externalRateId),
                            }),
                          },
                        );
                        setData({ ...data, [t.id]: result.rates });
                        setSuccess('MUST rate priority saved. Clock prices were not changed.');
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Priority could not be saved.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Save rate priority
                  </Button>
                ) : null}
              </div>
            ))
          : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Priority unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert role="status">
            <AlertTitle>Priority saved</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
