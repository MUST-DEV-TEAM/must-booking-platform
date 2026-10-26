/**
 * What each MUST feature needs from Clock, by the ids of the permission list. A feature is "ready" only
 * when every right it needs is confirmed; a hotel sees which feature is blocked and by which right.
 */
export type ClockFeatureRights = {
  key: string;
  label: string;
  /** What the hotel loses when a right is missing, in plain words. */
  impact: string;
  /** Required features break normal operation; optional or planned ones only limit extras. */
  required: boolean;
  planned?: boolean;
  needs: string[];
};

export const CLOCK_FEATURES: ClockFeatureRights[] = [
  {
    key: 'room-import',
    label: 'Importing rooms and room types',
    impact: 'Rooms and room types cannot be brought in from Clock.',
    required: true,
    needs: ['GET pms_api/room_types/', 'GET pms_api/rooms/'],
  },
  {
    key: 'prices',
    label: 'Rates, availability and live prices',
    impact:
      'Guests and staff cannot see availability or prices, and the rate choice stops working.',
    required: true,
    needs: ['GET pms_api/rates/', 'GET pms_api/rates_availability/', 'GET pms_api/products'],
  },
  {
    key: 'reservations',
    label: 'Creating and managing reservations',
    impact: 'Reservations cannot be created, read, changed or cancelled in Clock.',
    required: true,
    needs: [
      'GET pms_api/bookings/',
      'GET pms_api/bookings/:id',
      'POST pms_api/bookings/',
      'PUT pms_api/bookings/:id',
    ],
  },
  {
    key: 'live-updates',
    label: 'Live updates from Clock',
    impact: 'Changes made in Clock reach MUST late, only when it asks.',
    required: true,
    needs: ['GET base_api/webhook_subscription', 'POST base_api/webhook_subscription'],
  },
  {
    key: 'guests',
    label: 'Matching existing guests',
    impact: 'Returning guests are not recognised and may be duplicated.',
    required: false,
    needs: ['GET pms_api/guests/search'],
  },
  {
    key: 'payments',
    label: 'Recording payments in Clock',
    impact: 'Payments taken in MUST are not recorded on the guest’s bill in Clock.',
    required: false,
    needs: ['POST base_api/folios/:id/credit_items'],
  },
  {
    key: 'rate-plans',
    label: 'Real rate plans',
    impact: 'MUST keeps using its own hidden rate plans instead of Clock’s.',
    required: false,
    planned: true,
    needs: ['GET pms_api/rate_plans/', 'GET pms_api/rate_plans/:id'],
  },
  {
    key: 'rate-packages',
    label: 'Rate packages',
    impact: 'Package rates cannot be read.',
    required: false,
    planned: true,
    needs: ['GET pms_api/rate_packages/'],
  },
];
