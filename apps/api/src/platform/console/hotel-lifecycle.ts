export const LIFECYCLE_STATES = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'ARCHIVED',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const isLifecycleState = (value: unknown): value is LifecycleState =>
  typeof value === 'string' && (LIFECYCLE_STATES as readonly string[]).includes(value);

/** The only moves allowed. Trial and Past due are set by hand until Milestone 15 automates them. */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  TRIAL: ['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'],
  ACTIVE: ['PAST_DUE', 'SUSPENDED', 'CANCELLED'],
  PAST_DUE: ['ACTIVE', 'SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: ['ARCHIVED', 'ACTIVE'],
  ARCHIVED: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** Cancelling, archiving and reinstating a cancelled hotel need the dangerous-actions permission. */
export function needsDangerousPermission(from: LifecycleState, to: LifecycleState): boolean {
  return to === 'CANCELLED' || to === 'ARCHIVED' || (from === 'CANCELLED' && to === 'ACTIVE');
}

export type HotelAccess = 'allowed' | 'blocked' | 'read_only';

/**
 * What a state means for hotel staff on the dashboard.
 * Suspended and Cancelled block everything; Archived keeps the data readable but frozen.
 */
export function hotelDashboardAccess(state: LifecycleState, method: string): HotelAccess {
  if (state === 'SUSPENDED' || state === 'CANCELLED') return 'blocked';
  if (state === 'ARCHIVED') {
    return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'allowed' : 'read_only';
  }
  return 'allowed';
}

/** Public (guest) booking and availability run only for hotels that are in service. */
export function publicBookingAllowed(state: LifecycleState): boolean {
  return state === 'TRIAL' || state === 'ACTIVE' || state === 'PAST_DUE';
}

/** A hotel whose members can no longer sign in at all. */
export function blocksHotelLogin(state: LifecycleState): boolean {
  return state === 'SUSPENDED' || state === 'CANCELLED';
}

export const LIFECYCLE_LABELS: Readonly<Record<LifecycleState, string>> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
  ARCHIVED: 'Archived',
};
