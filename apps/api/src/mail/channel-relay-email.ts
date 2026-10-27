/**
 * Booking channels (Booking.com, Expedia, Airbnb, Agoda...) give the hotel a masked relay address instead of the
 * guest's own. Those relays belong to the channel and may not be used for the hotel's own messages, so a
 * reservation whose address is one of them is treated as having no email of its own.
 */
const RELAY_DOMAINS = [
  'guest.booking.com',
  'booking.com',
  'm.expediapartnercentral.com',
  'expediapartnercentral.com',
  'expedia.com',
  'guest.airbnb.com',
  'airbnb.com',
  'agoda.com',
  'agoda-emails.com',
  'hotelbeds.com',
  'trip.com',
  'hostelworld.com',
];

export function isChannelRelayEmail(email: string | null | undefined): boolean {
  const domain = email?.trim().toLowerCase().split('@')[1];
  if (!domain) return false;
  return RELAY_DOMAINS.some((relay) => domain === relay || domain.endsWith(`.${relay}`));
}
