'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Progress } from '../../components/ui/progress';
import { RatingDisplay } from '../../components/ui/rating-input';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { StatTile } from '../../components/ui/stat-tile';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

export type ReviewItem = {
  id: string;
  submittedAt: string;
  overall: number;
  categories: Record<string, number | null>;
  comment: string | null;
  booking: { id: string; reference: string; startsOn: string; endsOn: string; roomName: string };
  guest: { id: string | null; name: string | null; email: string | null } | null;
};

type Report = {
  summary: {
    overall: { average: number; count: number } | null;
    categories: Array<{ key: string; label: string; average: number | null; count: number }>;
  };
  items: ReviewItem[];
};

type Period = '30' | '365' | 'all';

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: '30', label: 'Last 30 days' },
  { value: '365', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

const CATEGORY_LABELS: Record<string, string> = {
  cleanliness: 'Cleanliness',
  staff: 'Staff',
  location: 'Location',
  comfort: 'Comfort',
  food: 'Food',
  valueForMoney: 'Value for money',
};

function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function stayRange(startsOn: string, endsOn: string) {
  const format = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${format(startsOn)} – ${format(endsOn)}`;
}

/** The "Guest reviews" tab in Reports: how guests rated the hotel, and each review tied to its stay. */
export function GuestReviewReport({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [period, setPeriod] = useState<Period>('365');
  const base = `/dashboard/${tenantId}?propertyId=${propertyId}`;
  const query = useQuery({
    queryKey: ['dashboard', 'guest-reviews', tenantId, propertyId, period],
    queryFn: async (): Promise<Report> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/guest-reviews?days=${period}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error(`Unable to load the reviews (${response.status}).`);
      return (await response.json()) as Report;
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">
          What guests said about their stay. Reviews are private to your team and are not published.
        </p>
        <SegmentedControl label="Period" options={PERIODS} value={period} onChange={setPeriod} />
      </div>

      {query.isPending ? <ListSkeleton rows={4} /> : null}
      {query.isError ? (
        <ErrorPanel title="Reviews unavailable" onRetry={() => void query.refetch()} />
      ) : null}

      {query.data ? (
        query.data.items.length === 0 ? (
          <EmptyPanel
            title="No reviews in this period"
            description="Guests are invited to review their stay by email after they leave. Their reviews appear here."
          />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
              <StatTile
                label="Overall score"
                value={
                  <span className="flex flex-col gap-2">
                    <span>
                      {query.data.summary.overall?.average.toFixed(1)}
                      <span className="text-base font-semibold text-muted-foreground"> / 5</span>
                    </span>
                    <RatingDisplay value={query.data.summary.overall?.average ?? null} />
                  </span>
                }
                note={`Based on ${query.data.summary.overall?.count ?? 0} ${
                  query.data.summary.overall?.count === 1 ? 'review' : 'reviews'
                }`}
              />
              <Card>
                <CardHeader>
                  <CardTitle>By category</CardTitle>
                  <CardDescription>
                    Average of the scores guests gave. Guests can skip a category.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="m-0 grid list-none gap-3 p-0">
                    {query.data.summary.categories.map((category) => (
                      <li
                        key={category.key}
                        className="grid grid-cols-[8rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm"
                      >
                        <span className="font-semibold">{category.label}</span>
                        <Progress
                          aria-label={`${category.label} average`}
                          value={category.average ? (category.average / 5) * 100 : 0}
                        />
                        <span className="text-right text-muted-foreground">
                          {category.average !== null
                            ? `${category.average.toFixed(1)} · ${category.count} ${
                                category.count === 1 ? 'rating' : 'ratings'
                              }`
                            : 'No ratings'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>All reviews</CardTitle>
                <CardDescription>
                  Newest first. Open the guest or the reservation to see the full picture.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table aria-label="Guest reviews">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>Reservation</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Stay</TableHead>
                      <TableHead>Overall</TableHead>
                      <TableHead>Comment</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.items.map((review) => (
                      <TableRow key={review.id}>
                        <TableCell>{shortDate(review.submittedAt)}</TableCell>
                        <TableCell>
                          {review.guest?.name || review.guest?.email ? (
                            review.guest.id ? (
                              <a
                                className="font-semibold text-primary hover:underline"
                                href={`${base}&section=guests&guest=${review.guest.id}`}
                              >
                                {review.guest.name ?? review.guest.email}
                              </a>
                            ) : (
                              (review.guest.name ?? review.guest.email)
                            )
                          ) : (
                            <span className="text-muted-foreground">Unknown</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <a
                            className="font-semibold text-primary hover:underline"
                            href={`${base}&section=reservations&reservation=${review.booking.id}`}
                          >
                            {review.booking.reference}
                          </a>
                        </TableCell>
                        <TableCell>{review.booking.roomName}</TableCell>
                        <TableCell>
                          {stayRange(review.booking.startsOn, review.booking.endsOn)}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-2">
                            <RatingDisplay value={review.overall} />
                            <span className="font-semibold">{review.overall}</span>
                          </span>
                        </TableCell>
                        <TableCell className="min-w-[20rem] whitespace-normal">
                          {review.comment ?? (
                            <span className="text-muted-foreground">No comment</span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[16rem] whitespace-normal">
                          {Object.entries(review.categories).some(([, score]) => score !== null) ? (
                            <span className="text-xs text-muted-foreground">
                              {Object.entries(review.categories)
                                .filter(([, score]) => score !== null)
                                .map(([key, score]) => `${CATEGORY_LABELS[key] ?? key} ${score}`)
                                .join(' · ')}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Overall only</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )
      ) : null}
    </div>
  );
}
