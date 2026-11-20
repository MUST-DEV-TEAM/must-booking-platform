/**
 * Who decides each part of the Booking rules page. Standalone hotels set everything in MUST. With a
 * connected PMS some rules are extra limits on top of the PMS (the stricter one always wins), some
 * are website rules the PMS does not know, and some only work in a standalone hotel for now.
 */
type Owner = { standalone: string; connected: string };

const SET_IN_MUST = 'Set in MUST';
const WEBSITE_RULE = 'Website rule · set in MUST';
const EXTRA_LIMIT = 'Extra limit · the stricter one wins';

const OWNERS: Record<string, Owner> = {
  'Length of stay': { standalone: SET_IN_MUST, connected: EXTRA_LIMIT },
  'Booking window and season': { standalone: SET_IN_MUST, connected: WEBSITE_RULE },
  'Same-day booking': { standalone: SET_IN_MUST, connected: WEBSITE_RULE },
  'Arrival and departure days': { standalone: SET_IN_MUST, connected: EXTRA_LIMIT },
  'Group size': { standalone: SET_IN_MUST, connected: WEBSITE_RULE },
  'Group requests': { standalone: SET_IN_MUST, connected: WEBSITE_RULE },
  'Guest ages': { standalone: SET_IN_MUST, connected: 'Prices follow your PMS' },
  'How guests choose rooms': { standalone: SET_IN_MUST, connected: 'Follows rooms from your PMS' },
  Confirmation: { standalone: SET_IN_MUST, connected: 'Not used with a connected PMS yet' },
  'Booking form': { standalone: SET_IN_MUST, connected: WEBSITE_RULE },
  Advanced: { standalone: SET_IN_MUST, connected: 'Standalone hotels only' },
  Cancellation: { standalone: SET_IN_MUST, connected: SET_IN_MUST },
  'House rules': { standalone: SET_IN_MUST, connected: SET_IN_MUST },
  'No-show guidance': { standalone: SET_IN_MUST, connected: SET_IN_MUST },
};

/** The note shown beside a section title, or nothing for a section that is not a rule. */
export function ruleOwnerLabel(title: string, connected: boolean): string | undefined {
  const owner = OWNERS[title];
  return owner ? (connected ? owner.connected : owner.standalone) : undefined;
}

/**
 * Sections that are saved and published to websites but not yet applied to real bookings. Remove a title
 * from this list in the same change that makes the booking check or the booking pages use it.
 */
const NOT_APPLIED_YET = new Set([
  'Group requests',
  'Guest ages',
  'Confirmation',
  'Booking form',
  'Advanced',
]);

export const NOT_APPLIED_LABEL = 'Saved · not applied to bookings yet';

/** A warning for a section whose settings are saved but do not change bookings yet. */
export function ruleStatusLabel(title: string): string | undefined {
  return NOT_APPLIED_YET.has(title) ? NOT_APPLIED_LABEL : undefined;
}
