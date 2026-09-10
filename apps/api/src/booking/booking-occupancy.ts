export type BookingOccupancyInput = {
  adults?: number;
  children?: number;
  /** Legacy input used only when neither new occupancy field is supplied. */
  guestCount?: number;
};

export type BookingOccupancy = {
  adults: number;
  children: number;
  guestCount: number;
};

/**
 * Normalizes the additive occupancy API. Existing clients that only send
 * guestCount retain their old behavior until the new fields are adopted.
 */
export function resolveBookingOccupancy(input: BookingOccupancyInput): BookingOccupancy {
  const adults = input.adults ?? (input.children === undefined ? (input.guestCount ?? 1) : 1);
  const children = input.children ?? 0;
  return { adults, children, guestCount: adults + children };
}

export function validBookingOccupancy(input: BookingOccupancyInput): boolean {
  const occupancy = resolveBookingOccupancy(input);
  return (
    Number.isInteger(occupancy.adults) &&
    occupancy.adults >= 1 &&
    Number.isInteger(occupancy.children) &&
    occupancy.children >= 0
  );
}
