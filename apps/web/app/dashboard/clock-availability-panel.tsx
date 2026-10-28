'use client';
import { ScopedHotelMoney } from './approximate-money';
import { formatMoney } from '../../lib/money';
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
  view = 'availability',
}: {
  tenantId: string;
  propertyId: string;
  view?: 'availability' | 'restrictions';
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const stored = useClockSnapshot<ClockMonth>(tenantId, propertyId, 'availability:' + month);
  const data = { ...stored, data: stored.data?.data?.roomTypes };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {view === 'restrictions'
            ? 'Sale closures and restrictions'
            : 'Availability by room type and date'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ClockSyncStatus tenantId={tenantId} propertyId={propertyId} inventoryOnly />
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
              {view === 'availability' ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-card">Room type</TableHead>
                      {data.data[0]?.days.map((day) => (
                        <TableHead key={day.date} className="min-w-16 text-center">
                          {day.date.slice(8)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((type) => (
                      <TableRow key={type.id}>
                        <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-card font-medium">
                          {type.name}
                        </TableCell>
                        {type.days.map((day) => (
                          <TableCell
                            key={day.date}
                            className="text-center"
                            title={`${day.date}: ${day.status}; ${day.availableUnits ?? 'unknown'} rooms; ${day.referencePrice ? formatMoney(day.referencePrice.amount, day.referencePrice.currency) : 'price not supplied'}`}
                          >
                            <span
                              className={
                                day.status === 'closed'
                                  ? 'rounded bg-amber-50 px-2 py-1 text-amber-800'
                                  : day.status === 'sold_out'
                                    ? 'rounded bg-red-50 px-2 py-1 text-red-700'
                                    : 'rounded bg-muted px-2 py-1'
                              }
                            >
                              {day.status === 'unavailable'
                                ? '?'
                                : day.status === 'closed'
                                  ? 'Closed'
                                  : (day.availableUnits ?? '?')}
                            </span>
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
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
                      type.days
                        .filter(
                          (day) =>
                            day.status === 'closed' ||
                            day.closedToArrival ||
                            day.closedToDeparture ||
                            (day.minStay !== undefined && day.minStay > 1),
                        )
                        .map((day) => (
                          <TableRow key={type.name + day.date}>
                            <TableCell>{type.name}</TableCell>
                            <TableCell>{day.date}</TableCell>
                            <TableCell>{day.availableUnits ?? 'Not supplied'}</TableCell>
                            <TableCell>
                              {day.referencePrice ? (
                                <ScopedHotelMoney {...day.referencePrice} />
                              ) : (
                                'Not supplied'
                              )}
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
              )}
              {view === 'restrictions' &&
              !data.data.some((type) =>
                type.days.some(
                  (day) =>
                    day.status === 'closed' ||
                    day.closedToArrival ||
                    day.closedToDeparture ||
                    (day.minStay !== undefined && day.minStay > 1),
                ),
              ) ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No sale closures or additional restrictions were supplied for this month.
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
