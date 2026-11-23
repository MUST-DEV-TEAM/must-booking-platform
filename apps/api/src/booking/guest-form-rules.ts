import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GuestDetails } from '@must/domain-contracts';

import type { TenantTransaction } from '../tenancy/tenant-database.service';

/**
 * The hotel's Booking form (Settings, Booking rules): each field is Required, Optional or Hidden. The server enforces
 * "Required" for a guest booking on the fields a hotel has to switch on itself: address, arrival time, special requests
 * and company. Phone and country are Required by default and every hotel website already asks for them; the API has
 * always accepted a guest booking without them, and many callers rely on that, so they are not enforced here (a hotel
 * that sets them Optional or Hidden simply has its website stop asking). "Hidden" never blocks a value a page chose to
 * send (a hotel's site may still collect an invoice address, for example). Staff bookings are not held to the form.
 */
export type FormFieldState = 'required' | 'optional' | 'hidden';

export interface GuestFormPolicy {
  formAddress: string | null;
  formArrivalTime: string | null;
  formSpecialRequests: string | null;
  formCompany: string | null;
}

/** What each field was before the hotel could choose (the column defaults), used when a value is missing. */
const FALLBACK: Record<keyof GuestFormPolicy, FormFieldState> = {
  formAddress: 'hidden',
  formArrivalTime: 'hidden',
  formSpecialRequests: 'optional',
  formCompany: 'hidden',
};

const state = (policy: GuestFormPolicy, key: keyof GuestFormPolicy): FormFieldState => {
  const value = policy[key];
  return value === 'required' || value === 'optional' || value === 'hidden' ? value : FALLBACK[key];
};

const filled = (value: string | null | undefined) =>
  typeof value === 'string' && value.trim() !== '';

/** The first Required field the guest left empty, as a message the guest can read, or null. */
export function missingRequiredGuestField(
  policy: GuestFormPolicy,
  guest: GuestDetails,
): string | null {
  if (
    state(policy, 'formAddress') === 'required' &&
    !(filled(guest.streetAddress) && filled(guest.city) && filled(guest.postcode))
  )
    return 'Please complete your address (street, city and postcode).';
  if (state(policy, 'formArrivalTime') === 'required' && !filled(guest.arrivalTime))
    return 'Please tell us your expected arrival time.';
  if (state(policy, 'formSpecialRequests') === 'required' && !filled(guest.specialRequests))
    return 'Please fill in your special requests.';
  if (state(policy, 'formCompany') === 'required' && !filled(guest.companyName))
    return 'Please enter your company name.';
  // Marketing consent is never required: a booking cannot be made to depend on agreeing to marketing.
  return null;
}

const COLUMNS = Prisma.raw(
  [
    'form_address AS "formAddress"',
    'form_arrival_time AS "formArrivalTime"',
    'form_special_requests AS "formSpecialRequests"',
    'form_company AS "formCompany"',
  ].join(', '),
);

/** Rechecked inside the booking's own transaction, so a stale page cannot skip a field the hotel now requires. */
export async function enforceGuestForm(
  tx: TenantTransaction,
  c: { tenantId: string; propertyId: string },
  guest: GuestDetails,
): Promise<void> {
  const rows = await tx.$queryRaw<
    GuestFormPolicy[]
  >`SELECT ${COLUMNS} FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid`;
  if (!rows[0]) throw new NotFoundException('Property not found.');
  const problem = missingRequiredGuestField(rows[0], guest);
  if (problem) throw new BadRequestException(problem);
}

/**
 * "Ask children's ages" (Settings, Booking rules, Guest ages): when the hotel switched it on, a guest booking that
 * includes children must say how old each child is, so rates that price by age are charged correctly. Off by default,
 * so existing callers are unaffected. The ages themselves are checked by the occupancy rules (whole years, one per child).
 */
export function missingChildrenAges(
  askChildrenAges: boolean | null | undefined,
  occupancy: { children: number },
  childrenAges: number[] | undefined,
): string | null {
  if (askChildrenAges !== true || occupancy.children < 1) return null;
  if (!childrenAges || childrenAges.length !== occupancy.children)
    return "Please tell us each child's age.";
  return null;
}

/** Rechecked inside the booking's own transaction, like the booking form. */
export async function enforceChildrenAges(
  tx: TenantTransaction,
  c: { tenantId: string; propertyId: string },
  occupancy: { children: number },
  childrenAges: number[] | undefined,
): Promise<void> {
  if (occupancy.children < 1) return;
  const rows = await tx.$queryRaw<
    { ask: boolean | null }[]
  >`SELECT ask_children_ages AS ask FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid`;
  if (!rows[0]) throw new NotFoundException('Property not found.');
  const problem = missingChildrenAges(rows[0].ask, occupancy, childrenAges);
  if (problem) throw new BadRequestException(problem);
}

/** An arrival time is HH:MM on a 24-hour clock; anything else is dropped by the caller. */
export const ARRIVAL_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
