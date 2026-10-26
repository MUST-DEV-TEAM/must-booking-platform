import type { ClockCatalogEntry } from './clock-api-catalog';

const SPECIAL: Record<string, string> = {
  'GET pms_api/': 'Read basic information about the hotel account.',
  'GET base_api/': 'Read basic information about the hotel account.',
  'GET pms_api/rates/': 'Read every rate (price list) of the hotel and what it includes.',
  'GET pms_api/products': 'Ask Clock for the available rooms and live prices for a stay.',
  'GET pms_api/rates_availability/':
    'Read which rooms are free and what restrictions apply on each date.',
  'GET pms_api/bookings/': 'Read the list of reservations.',
  'POST pms_api/bookings/': 'Create a new reservation.',
  'PUT pms_api/bookings/:id': 'Change or cancel an existing reservation.',
  'GET pms_api/guests/search': 'Search for a guest by name, email or phone.',
  'GET pms_api/wbe_config': 'Read the hotel’s online booking settings.',
  'POST base_api/webhook_subscription': 'Subscribe MUST to live updates from Clock.',
  'DELETE base_api/webhook_subscription': 'Stop the live updates from Clock.',
  'GET base_api/webhook_subscription': 'Check whether live updates from Clock are switched on.',
  'POST base_api/folios/:id/credit_items': 'Record a payment on a guest’s bill.',
  'POST base_api/folios/:id/close': 'Close a guest’s bill.',
  'POST base_api/folios/:id/charges/': 'Add a charge to a guest’s bill.',
  'POST base_api/folios/:id/charges/bulk': 'Add several charges to a guest’s bill at once.',
  'DELETE base_api/folios/:id/charges/:id': 'Remove a charge from a guest’s bill.',
};

const LABELS: Record<string, string> = {
  bookings: 'reservations',
  booking_guests: 'guests on a reservation',
  booking_offers: 'booking offers',
  booking_self_service_to_dos: 'self-service tasks of a reservation',
  booking_credit_cards: 'cards saved on a reservation',
  registration_cards: 'registration cards',
  charges_by_source: 'charges of a reservation',
  folios: 'guest bills (folios)',
  folio_taxes: 'taxes on a guest bill',
  credit_items: 'payments on a guest bill',
  charges: 'charges on a guest bill',
  charge_templates: 'charge templates',
  charge_template_availabilities: 'where each charge template can be used',
  charge_logs: 'the history of charges',
  credit_item_logs: 'the history of payments',
  folio_ledger: 'the accounting ledger',
  fiscalization: 'tax-authority (fiscal) data',
  revenue_categories: 'revenue categories',
  payment_sub_types: 'payment types',
  payment_terminals: 'card terminals',
  closures: 'day closings',
  exchange_rates: 'exchange rates',
  document_types: 'document types',
  users: 'staff users',
  companies: 'companies',
  rates: 'rates',
  rate_plans: 'rate plans',
  rate_packages: 'rate packages',
  rate_prices: 'prices and restrictions of a rate',
  rooms: 'rooms',
  room_types: 'room types',
  room_statuses: 'room statuses',
  availability_adjustments: 'availability adjustments',
  price_boundaries: 'price limits',
  meals: 'meal plans',
  guests: 'guests',
  events: 'events',
  blocks: 'room blocks (groups)',
  block_rooms: 'rooms inside a block',
  block_pickups: 'how many rooms of a block were taken',
  block_prices: 'block prices',
  meeting_rooms: 'meeting rooms',
  meeting_room_bookings: 'meeting room bookings',
  meeting_room_availability: 'meeting room availability',
  caterings: 'catering orders',
  door_keys: 'door keys',
  activities: 'activities',
  occupancy_forecasts: 'occupancy forecasts',
  phone_calls: 'phone call records',
  identity_tag: 'identity tags on a reservation',
  adyen_v2: 'card payment tokens',
  credit_cards: 'saved cards',
  credit_card_transactions: 'card transactions',
  custom_payment_purchases: 'custom payment purchases',
  elavon_token: 'card payment tokens',
  chargeable_folios: 'bills that can receive charges',
  find_in_hotel: 'a reservation found by its details',
  find_by_tag: 'a reservation found by its tag',
  bookings_by_room: 'reservations of a room',
  assign_identity_tag: 'an identity tag on a reservation',
  unassign_identity_tag: 'an identity tag on a reservation',
  set_billing_to_company: 'the company that pays a bill',
  set_billing_to_person: 'the guest that pays a bill',
  terminal_transactions: 'card terminal transactions',
  activities_providers: 'activity providers',
};

function humanise(segment: string): string {
  return LABELS[segment] ?? segment.replace(/_/g, ' ');
}

/** One plain sentence about what a Clock request lets MUST do. */
export function describeClockRequest(entry: ClockCatalogEntry): string {
  const id = `${entry.method} ${entry.api}${entry.path}`;
  const special = SPECIAL[id];
  if (special) return special;
  const segments = entry.path.split('/').filter(Boolean);
  const named = segments.filter((segment) => !segment.startsWith(':'));
  const last = named[named.length - 1] ?? '';
  const parent = named.length > 1 ? humanise(named[named.length - 2]!) : '';
  const single = segments[segments.length - 1]?.startsWith(':') ?? false;
  const what = humanise(last);
  const where = parent && last !== named[0] ? ` (under ${parent})` : '';
  switch (entry.method) {
    case 'GET':
      return single ? `Read one of the ${what}${where}.` : `Read the list of ${what}${where}.`;
    case 'POST':
      return segments.length > 1 && segments[segments.length - 1]?.startsWith(':')
        ? `Perform an action on ${what}${where}.`
        : `Create new ${what}${where}.`;
    case 'PUT':
    case 'PATCH':
      return `Change existing ${what}${where}.`;
    case 'DELETE':
      return `Delete ${what}${where}.`;
    default:
      return `${entry.method} ${what}.`;
  }
}

/** Anything that moves money or fiscal data gets a clear warning label in the dashboard. */
export function touchesMoney(entry: ClockCatalogEntry): boolean {
  return /folio|charge|credit|payment|fiscal|ledger|closure|terminal|adyen|elavon|revenue/i.test(
    entry.path,
  );
}
