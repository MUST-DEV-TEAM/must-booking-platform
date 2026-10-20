'use client';

import { useMutation, useQuery } from '@tanstack/react-query';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';

type Review = {
  needsReview: boolean;
  canCheck: boolean;
  reasons: Array<{ text: string; openedAt: string }>;
};
type CheckResult =
  | { result: 'found'; clockBookingId: string; linked: boolean }
  | { result: 'not_found' }
  | { result: 'unavailable'; message: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === 'string' ? body.message : 'Something went wrong.');
  }
  return (await response.json()) as T;
}

/** Plain-words outcome of a read-only check; resolving the review itself is done by MUST support. */
export function checkMessage(result: CheckResult): string {
  if (result.result === 'unavailable') return result.message;
  if (result.result === 'not_found')
    return 'The property system does not have this booking. Do not try to create it again yourself; ask MUST support to review it.';
  return result.linked
    ? 'The property system has this booking and it matches our record. If the status still looks wrong, ask MUST support to clear the review.'
    : 'The property system already has a booking with this reference, but it is not linked to this record yet. Do not create it again; ask MUST support to link it.';
}

/** Shown on a booking only when something about it needs review. */
export function BookingReviewCard({
  tenantId,
  propertyId,
  bookingId,
  canRunCheck,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  canRunCheck: boolean;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}/review`;
  const review = useQuery({
    queryKey: ['dashboard', 'booking-review', tenantId, propertyId, bookingId],
    queryFn: () => request<Review>(base),
  });
  const check = useMutation({
    mutationFn: () => request<CheckResult>(`${base}/check`, { method: 'POST' }),
  });
  if (!review.data?.needsReview) return null;
  return (
    <Alert variant="warning">
      <AlertTitle>This booking needs review</AlertTitle>
      <AlertDescription>
        <span className="flex flex-col gap-2">
          {review.data.reasons.length ? (
            review.data.reasons.map((reason) => (
              <span key={`${reason.text}-${reason.openedAt}`}>
                {reason.text} (since {new Date(reason.openedAt).toLocaleString()})
              </span>
            ))
          ) : (
            <span>The booking is in a state that needs a person to look at it.</span>
          )}
          {check.data ? <span role="status">{checkMessage(check.data)}</span> : null}
          {check.error ? <span role="alert">{check.error.message}</span> : null}
          {review.data.canCheck && canRunCheck ? (
            <span>
              <Button
                variant="outline"
                size="sm"
                disabled={check.isPending}
                onClick={() => check.mutate()}
              >
                {check.isPending ? 'Checking…' : 'Run check'}
              </Button>
            </span>
          ) : null}
          <span className="text-xs">
            The check only looks; it changes nothing. Clearing a review is done by MUST support.
          </span>
        </span>
      </AlertDescription>
    </Alert>
  );
}
