'use client';
import { useState } from 'react';
import { useClockSnapshot, ClockSyncStatus, type ClockMonth } from './clock-sync';
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
export function ClockAvailabilityPanel({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const stored = useClockSnapshot<ClockMonth>(tenantId, propertyId, 'availability:' + month);
  const data = { ...stored, data: stored.data?.data?.roomTypes };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Synchronized availability and restrictions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ClockSyncStatus tenantId={tenantId} propertyId={propertyId} />
        <p className="text-sm text-muted-foreground">
          Latest synchronized Clock availability for one adult. Closed means stopped for sale; Sold
          out means no bookable rooms for this selection. Final prices and eligibility are checked
          for the actual stay. Reference prices are the lowest open published rate for one adult,
          one night; they are not a final stay quote.
        </p>
        <Input
          className="sm:max-w-48"
          aria-label="Clock availability month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        {!data.data ? (
          <p role="status">
            This month is being synchronized automatically. Stored data will appear here.
          </p>
        ) : null}
        {data.error ? <p role="alert">{data.error.message}</p> : null}
        {data.data ? (
          <>
            <p className="text-xs">
              Last synchronized{' '}
              {stored.data?.lastSyncedAt
                ? new Date(stored.data.lastSyncedAt).toLocaleString()
                : 'updating'}
              . Complete block history remains managed in Clock.
            </p>
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room type</TableHead>
                    <TableHead>Night</TableHead>
                    <TableHead>Rooms free</TableHead>
                    <TableHead>Reference price</TableHead>
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
                          {day.referencePrice
                            ? `${day.referencePrice.amount} ${day.referencePrice.currency}`
                            : 'Not supplied'}
                        </TableCell>
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
