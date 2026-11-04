export type Venue = {
  id: string;
  propertyId: string | null;
  name: string;
  slug: string;
  timezone: string | null;
  currency: string | null;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  active: boolean;
  description: string | null;
  /** Set once the first-time setup has been finished; the setup guide shows until then. */
  setupCompletedAt: string | null;
  advanceBookingDays: number;
  maxOnlinePartySize: number;
  holdMinutes: number;
  lastBookingMinutesBeforeClose: number;
  diningMinutes: number;
  depositMode: DepositMode;
  /** Exact text with two decimals, for example "30.00". */
  depositValue: string;
  depositMinParty: number;
  freeCancelHours: number;
};

export type DepositMode = 'none' | 'percent' | 'fixed';

/** The fields the setup guide and the Setup tab can change on a restaurant. */
export type VenueUpdate = Partial<{
  name: string;
  phone: string;
  contactEmail: string;
  description: string;
  timezone: string;
  currency: string;
  advanceBookingDays: number;
  maxOnlinePartySize: number;
  holdMinutes: number;
  lastBookingMinutesBeforeClose: number;
  diningMinutes: number;
  depositMode: DepositMode;
  depositValue: string;
  depositMinParty: number;
  freeCancelHours: number;
}>;

/** Settings -> Integrations -> Restaurant, for one hotel. */
export type RestaurantIntegration = {
  /** Restaurants are currently available on every plan. */
  available: boolean;
  venue: { id: string; name: string; active: boolean; setupCompletedAt: string | null } | null;
};

/** One opening-hours service, for example Dinner. Days: 1 = Monday ... 7 = Sunday. */
export type VenueService = {
  id?: string;
  name: string;
  days: number[];
  opensAt: string;
  closesAt: string;
  slotMinutes: number;
};

export type TableShape = 'square' | 'round' | 'rect';

export type VenueTable = {
  notes?: string | null;
  features?: string[];
  onlineBookable?: boolean;
  priority?: number;
  id: string;
  areaId: string;
  label: string;
  minSeats: number;
  maxSeats: number;
  mapX: number;
  mapY: number;
  mapWidth: number;
  mapHeight: number;
  shape: TableShape;
  active: boolean;
};

export type VenueArea = {
  id: string;
  name: string;
  sortOrder: number;
  mapWidth: number;
  mapHeight: number;
  active: boolean;
  tables: VenueTable[];
};

export type VenueLayout = {
  areas: VenueArea[];
  combinations: Array<{ tableAId: string; tableBId: string }>;
};

export type VenueInput = {
  name: string;
  timezone?: string;
  currency?: string;
  propertyId?: string;
};

export type TableInput = {
  notes?: string | null;
  features?: string[];
  onlineBookable?: boolean;
  priority?: number;
  mapWidth?: number;
  mapHeight?: number;
  label: string;
  minSeats: number;
  maxSeats: number;
  shape: TableShape;
  mapX?: number;
  mapY?: number;
};

export type VenueRole = 'MANAGER' | 'HOST';

export type VenueStaffMember = {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: VenueRole;
  suspendedAt: string | null;
};

export type WorkspaceMember = { userId: string; email: string; role: 'OWNER' | 'ADMIN' | 'STAFF' };

/** The API's error body carries a readable `message` and, for plan limits, a machine `code`. */
export class VenueApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** The rest of the error body, for example the `missing` steps of an unfinished setup. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** What the setup still needs, as reported when finishing it is refused. */
export function missingSetupSteps(error: unknown): string[] {
  const missing = error instanceof VenueApiError ? error.details?.missing : undefined;
  return Array.isArray(missing)
    ? missing.filter((item): item is string => typeof item === 'string')
    : [];
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as
      ({ message?: string | string[]; code?: string } & Record<string, unknown>) | null;
    const message = Array.isArray(error?.message) ? error.message.join(' ') : error?.message;
    throw new VenueApiError(
      message ?? 'Something went wrong.',
      response.status,
      error?.code,
      error ?? undefined,
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export { call as venueCall };

export const venueBase = (tenantId: string, venueId: string) =>
  `/tenants/${tenantId}/venues/${venueId}`;

export const venueApi = {
  listVenues: (tenantId: string) => call<Venue[]>('GET', `/tenants/${tenantId}/venues`),
  createVenue: (tenantId: string, input: VenueInput) =>
    call<Venue>('POST', `/tenants/${tenantId}/venues`, input),
  getVenue: (tenantId: string, venueId: string) => call<Venue>('GET', venueBase(tenantId, venueId)),
  updateVenue: (tenantId: string, venueId: string, input: VenueUpdate) =>
    call<Venue>('PATCH', venueBase(tenantId, venueId), input),
  completeSetup: (tenantId: string, venueId: string) =>
    call<Venue>('POST', `${venueBase(tenantId, venueId)}/complete-setup`),
  listServices: (tenantId: string, venueId: string) =>
    call<VenueService[]>('GET', `${venueBase(tenantId, venueId)}/services`),
  saveServices: (tenantId: string, venueId: string, services: VenueService[]) =>
    call<VenueService[]>('PUT', `${venueBase(tenantId, venueId)}/services`, {
      services: services.map(({ id, name, days, opensAt, closesAt, slotMinutes }) => ({
        ...(id ? { id } : {}),
        name,
        days,
        opensAt,
        closesAt,
        slotMinutes,
      })),
    }),
  getRestaurantIntegration: (tenantId: string, propertyId: string) =>
    call<RestaurantIntegration>('GET', `/tenants/${tenantId}/properties/${propertyId}/restaurant`),
  setRestaurantIntegration: (tenantId: string, propertyId: string, on: boolean) =>
    call<RestaurantIntegration>(
      'POST',
      `/tenants/${tenantId}/properties/${propertyId}/restaurant/${on ? 'activate' : 'deactivate'}`,
    ),
  createStaffAccount: (
    tenantId: string,
    venueId: string,
    input: {
      firstName: string;
      lastName?: string;
      email: string;
      password: string;
      role: VenueRole;
    },
  ) => call<VenueStaffMember>('POST', `${venueBase(tenantId, venueId)}/staff`, input),
  getLayout: (tenantId: string, venueId: string) =>
    call<VenueLayout>('GET', `${venueBase(tenantId, venueId)}/layout`),
  createArea: (tenantId: string, venueId: string, input: { name: string }) =>
    call<VenueArea>('POST', `${venueBase(tenantId, venueId)}/areas`, input),
  updateArea: (tenantId: string, venueId: string, areaId: string, input: { name: string }) =>
    call<VenueArea>('PATCH', `${venueBase(tenantId, venueId)}/areas/${areaId}`, input),
  deleteArea: (tenantId: string, venueId: string, areaId: string) =>
    call<void>('DELETE', `${venueBase(tenantId, venueId)}/areas/${areaId}`),
  createTable: (tenantId: string, venueId: string, areaId: string, input: TableInput) =>
    call<VenueTable>('POST', `${venueBase(tenantId, venueId)}/areas/${areaId}/tables`, input),
  updateTable: (
    tenantId: string,
    venueId: string,
    tableId: string,
    input: Partial<TableInput> & { active?: boolean },
  ) => call<VenueTable>('PATCH', `${venueBase(tenantId, venueId)}/tables/${tableId}`, input),
  deleteTable: (tenantId: string, venueId: string, tableId: string) =>
    call<void>('DELETE', `${venueBase(tenantId, venueId)}/tables/${tableId}`),
  savePositions: (
    tenantId: string,
    venueId: string,
    positions: Array<{
      tableId: string;
      mapX: number;
      mapY: number;
      mapWidth?: number;
      mapHeight?: number;
    }>,
  ) =>
    call<{ moved: number }>('PUT', `${venueBase(tenantId, venueId)}/layout/positions`, {
      positions,
    }),
  listStaff: (tenantId: string, venueId: string) =>
    call<VenueStaffMember[]>('GET', `${venueBase(tenantId, venueId)}/staff`),
  assignStaff: (tenantId: string, venueId: string, userId: string, role: VenueRole) =>
    call<VenueStaffMember>('PUT', `${venueBase(tenantId, venueId)}/staff/${userId}`, { role }),
  setStaffSuspended: (tenantId: string, venueId: string, userId: string, suspended: boolean) =>
    call<VenueStaffMember>(
      'POST',
      `${venueBase(tenantId, venueId)}/staff/${userId}/${suspended ? 'suspend' : 'resume'}`,
    ),
  listMembers: (tenantId: string) =>
    call<WorkspaceMember[]>('GET', `/tenants/${tenantId}/memberships`),
  setCombinable: (tenantId: string, venueId: string, tableId: string, tableIds: string[]) =>
    call<{ tableIds: string[] }>(
      'PUT',
      `${venueBase(tenantId, venueId)}/tables/${tableId}/combinable`,
      { tableIds },
    ),
};
