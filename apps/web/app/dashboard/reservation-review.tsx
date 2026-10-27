'use client';

import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { RatingDisplay } from '../../components/ui/rating-input';
import type { ReviewItem } from './guest-review-report';

const LABELS: Record<string, string> = {
  cleanliness: 'Cleanliness',
  staff: 'Staff',
  location: 'Location',
  comfort: 'Comfort',
  food: 'Food',
  valueForMoney: 'Value for money',
};

/** What the guest said about this stay. Shown only when they left a review. */
export function ReservationReview({
  tenantId,
  propertyId,
  bookingId,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
}) {
  const query = useQuery({
    queryKey: ['dashboard', 'reservation-review', tenantId, propertyId, bookingId],
    queryFn: async (): Promise<ReviewItem | null> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/guest-reviews/booking/${bookingId}`,
        { credentials: 'include' },
      );
      // A role without access to reviews simply sees no review box.
      if (!response.ok) return null;
      return ((await response.json()) as { review: ReviewItem | null }).review;
    },
  });
  const review = query.data;
  if (!review) return null;
  const rated = Object.entries(review.categories).filter(([, score]) => score !== null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Guest review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <RatingDisplay value={review.overall} />
          <span className="font-bold">{review.overall} / 5</span>
          <span className="text-sm text-muted-foreground">
            ·{' '}
            {new Date(review.submittedAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>
        {rated.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-muted-foreground">
            {rated.map(([key, score]) => (
              <li key={key}>
                {LABELS[key] ?? key} <strong className="text-foreground">{score}</strong>
              </li>
            ))}
          </ul>
        ) : null}
        {review.comment ? <p className="m-0 text-sm">{review.comment}</p> : null}
      </CardContent>
    </Card>
  );
}
