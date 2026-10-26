'use client';
import { useClockSnapshot } from './clock-sync';
import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
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

/** Every rate Clock publishes for the booking engine, by room type. Read-only: rates and prices live in Clock. */
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
  const data = snapshot.data?.data?.roomTypes ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rates by room type</CardTitle>
        <CardDescription>
          Every rate below is shown to guests and staff, who choose; nothing is chosen for them and
          there is no priority to set. Rates and prices are managed in Clock. To see what each rate
          costs for a stay, use “Check selected stay price” above.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="m-0 text-xs text-muted-foreground">
          {snapshot.data?.lastSyncedAt
            ? `Last synchronized ${new Date(snapshot.data.lastSyncedAt).toLocaleString()}`
            : 'Rates are synchronizing automatically.'}
        </p>
        {data
          ? types.map((type) => {
              const rates = [...(data[type.id] ?? [])].sort((a, b) =>
                (a.label ?? a.name).localeCompare(b.label ?? b.name),
              );
              return (
                <div key={type.id} className="flex flex-col gap-2">
                  <p className="m-0 font-semibold">{type.name}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate</TableHead>
                        <TableHead>Meals</TableHead>
                        <TableHead>Guests allowed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rates.map((rate) => (
                        <TableRow key={rate.externalRateId}>
                          <TableCell>
                            <span className="font-medium">{rate.label ?? rate.name}</span>
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
                            {limit(rate.maxAdults, 'adults')}; {limit(rate.maxChildren, 'children')}
                          </TableCell>
                        </TableRow>
                      ))}
                      {rates.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3}>
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
    </Card>
  );
}
