'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
type Day = {
  date: string;
  status: string;
  availableUnits?: number;
  minStay?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
};
export function ClockAvailabilityPanel({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [loaded, setLoaded] = useState(false);
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const data = useQuery({
    queryKey: ['dashboard', 'clock-read-availability', tenantId, propertyId, month],
    enabled: loaded,
    queryFn: async () => {
      const read = async (path: string) => {
        const r = await fetch(base + path, { credentials: 'include' });
        if (!r.ok) throw new Error('Clock availability could not be loaded. Try again shortly.');
        return r.json();
      };
      const types = (await read('/room-types')) as Array<{ id: string; name: string }>;
      const result: Array<{ name: string; days: Day[] }> = [];
      for (const type of types) {
        const response = await read(
          `/availability-calendar?roomTypeId=${encodeURIComponent(type.id)}&month=${month}`,
        );
        result.push({ name: type.name, days: response.days });
      }
      return result;
    },
    staleTime: 1200000,
    refetchOnWindowFocus: false,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clock availability and day restrictions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Read-only snapshot for one adult. Room counts come from Clock; Closed means stopped for
          sale, Sold out means no offer for this selection. Prices and final booking eligibility are
          checked for the actual guests and stay. Complete block history and hotel occupancy are
          managed in Clock.
        </p>
        <div className="flex gap-2">
          <Input
            aria-label="Clock availability month"
            type="month"
            value={month}
            onChange={(e) => {
              setLoaded(false);
              setMonth(e.target.value);
            }}
          />
          <Button
            disabled={data.isFetching || !month}
            onClick={() => {
              if (loaded) void data.refetch();
              else setLoaded(true);
            }}
          >
            {data.isFetching ? 'Reading Clock?' : 'Load Clock availability'}
          </Button>
        </div>
        {data.error ? <p role="alert">{data.error.message}</p> : null}
        {data.data ? (
          <>
            <p className="text-xs">
              Last read {new Date(data.dataUpdatedAt).toLocaleString()}. Provider data may be cached
              for up to 20 minutes.
            </p>
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room type</TableHead>
                    <TableHead>Night</TableHead>
                    <TableHead>Rooms free</TableHead>
                    <TableHead>Sale status</TableHead>
                    <TableHead>Restrictions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.flatMap((type) =>
                    type.days.map((day) => (
                      <TableRow key={type.name + day.date}>
                        <TableCell>{type.name}</TableCell>
                        <TableCell>{day.date}</TableCell>
                        <TableCell>{day.availableUnits ?? 'Not supplied'}</TableCell>
                        <TableCell>
                          {(
                            {
                              available: 'Open',
                              closed: 'Closed',
                              sold_out: 'Sold out',
                              unavailable: 'Not supplied',
                            } as Record<string, string>
                          )[day.status] ?? 'Not supplied'}
                        </TableCell>
                        <TableCell>
                          {[
                            day.closedToArrival ? 'No arrivals' : '',
                            day.closedToDeparture ? 'No departures' : '',
                            day.minStay ? `Minimum ${day.minStay} nights` : '',
                          ]
                            .filter(Boolean)
                            .join('; ') || 'No additional day restrictions supplied'}
                        </TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
