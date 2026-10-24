'use client';

import { ConfirmDialog } from '../../../../../components/ui/confirm-dialog';
import {
  consolePost,
  type HotelDetail,
  LIFECYCLE_LABELS,
  type LifecycleState,
} from '../../../../../lib/platform-api';

const EFFECTS: Record<LifecycleState, string> = {
  TRIAL: 'The hotel keeps working normally.',
  ACTIVE: 'The hotel works normally.',
  PAST_DUE: 'The hotel keeps working. This only marks the account as overdue until billing exists.',
  SUSPENDED:
    'Hotel staff can no longer sign in or use the dashboard, and the hotel stops taking public bookings. Nothing is deleted.',
  CANCELLED:
    'Hotel staff can no longer sign in, and public booking is closed. Data is kept. A Super admin can reinstate it.',
  ARCHIVED:
    'The hotel becomes read-only and closed to public booking. Data is retained; this cannot be undone in the console.',
};

/** Asks for a written reason (and a typed word for the most serious moves), then changes the status. */
export function LifecycleDialog({
  hotel,
  target,
  onClose,
  onDone,
}: {
  hotel: HotelDetail;
  target: LifecycleState;
  onClose: () => void;
  onDone: () => void;
}) {
  const serious = target === 'CANCELLED' || target === 'ARCHIVED';
  const destructive = target === 'SUSPENDED' || serious;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Move ${hotel.name} to ${LIFECYCLE_LABELS[target]}?`}
      description={
        <>
          From <strong>{LIFECYCLE_LABELS[hotel.lifecycle.state]}</strong> to{' '}
          <strong>{LIFECYCLE_LABELS[target]}</strong>. {EFFECTS[target]}
        </>
      }
      confirmLabel={`Move to ${LIFECYCLE_LABELS[target]}`}
      cancelLabel="Cancel"
      destructive={destructive}
      reasonLabel="Reason (kept in the audit log and the hotel’s history)"
      reasonRequired
      reasonPlaceholder="For example: contract signed, unpaid invoice, owner asked to close"
      typedWord={serious ? LIFECYCLE_LABELS[target].toUpperCase() : undefined}
      onConfirm={async (reason) => {
        await consolePost(`/hotels/${hotel.id}/lifecycle`, {
          to: target,
          reason,
          version: hotel.lifecycle.version,
        });
        onDone();
      }}
    />
  );
}
