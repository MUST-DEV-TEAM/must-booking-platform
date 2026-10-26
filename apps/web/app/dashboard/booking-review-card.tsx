'use client';
import { useState } from 'react';
import { Input } from '../../components/ui/input';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';

type Review = {
  needsReview: boolean;
  canCheck: boolean;
  canResolve?: boolean;
  pendingChange?: 'stay' | 'room' | null;
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
    return 'Clock returned no matching reservation. A reviewer can close this as not created after the safety checks pass.';
  return result.linked
    ? 'Clock has a matching reservation. Link and synchronize it to resolve the booking status.'
    : 'Clock has a matching reservation that can be linked to this record. Do not create another reservation.';
}

/** Shown on a booking only when something about it needs review. */
export function BookingReviewCard({
  tenantId,
  propertyId,
  bookingId,
  canRunCheck,
  alwaysShow = false,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  canRunCheck: boolean;
  alwaysShow?: boolean;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}/review`;
  const client = useQueryClient();
  const [note, setNote] = useState('');
  const resolve = useMutation({
    mutationFn: (action: string) =>
      request(`${base}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['dashboard'] }),
  });
  const review = useQuery({
    queryKey: ['dashboard', 'booking-review', tenantId, propertyId, bookingId],
    queryFn: () => request<Review>(base),
  });
  const check = useMutation({
    mutationFn: () => request<CheckResult>(`${base}/check`, { method: 'POST' }),
  });
  const verifyChange = useMutation({
    mutationFn: async () => {
      const bookingBase = base.slice(0, -'/review'.length);
      const result = await request<{ ok: boolean; error?: { message?: string } }>(
        review.data?.pendingChange === 'room'
          ? bookingBase + '/room-move/check'
          : bookingBase + '/amend-check',
        { method: 'POST' },
      );
      if (!result.ok)
        throw new Error(
          result.error?.message || 'Clock could not verify this change. Try again shortly.',
        );
      return result;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['dashboard'] }),
  });
  if (review.isPending) return alwaysShow ? <p role="status">Loading provider review...</p> : null;
  if (review.error) return alwaysShow ? <p role="alert">{review.error.message}</p> : null;
  if (!review.data?.needsReview)
    return alwaysShow ? (
      <p className="text-sm text-muted-foreground">
        No open provider issues are recorded for this reservation.
      </p>
    ) : null;
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
            <span>
              {review.data.pendingChange
                ? 'The saved booking change needs confirmation from Clock.'
                : 'The booking is in a state that needs a person to look at it.'}
            </span>
          )}
          {review.data.pendingChange && canRunCheck && review.data.canCheck ? (
            <span>
              <Button
                variant="outline"
                size="sm"
                disabled={verifyChange.isPending}
                onClick={() => verifyChange.mutate()}
              >
                {verifyChange.isPending
                  ? 'Verifying saved change...'
                  : review.data.pendingChange === 'room'
                    ? 'Verify room move'
                    : 'Verify stay change'}
              </Button>
              {verifyChange.error ? (
                <span role="alert" className="mt-2 block">
                  {verifyChange.error.message}
                </span>
              ) : null}
              <span className="mt-2 block text-xs">
                Checks the result of the saved change without submitting it again. Any guest email
                you selected is sent after successful verification.
              </span>
            </span>
          ) : null}
          {check.data ? <span role="status">{checkMessage(check.data)}</span> : null}
          {check.error ? <span role="alert">{check.error.message}</span> : null}
          {review.data.canCheck && canRunCheck && !review.data.pendingChange ? (
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
          {!review.data.pendingChange &&
          review.data.canResolve &&
          check.data &&
          check.data.result !== 'unavailable' ? (
            <span className="flex flex-col gap-2">
              <Input
                aria-label="Resolution note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you verify?"
                maxLength={500}
              />
              <Button
                variant="outline"
                disabled={note.trim().length < 3 || resolve.isPending}
                onClick={() =>
                  resolve.mutate(check.data?.result === 'found' ? 'link' : 'not_created')
                }
              >
                {check.data.result === 'found'
                  ? 'Link and synchronize booking'
                  : 'Close as not created'}
              </Button>
              {resolve.error ? <span role="alert">{resolve.error.message}</span> : null}
            </span>
          ) : null}
          {!review.data.pendingChange ? (
            <span className="text-xs">
              Resolution checks Clock again and records who reviewed the outcome. No new reservation
              or payment is created.
            </span>
          ) : null}
        </span>
      </AlertDescription>
    </Alert>
  );
}
