/** One synchronization job as the status query returns it. */
export interface SyncJobRow {
  resource: string;
  status: string;
  processed: number;
  /** Items in the list this job is working through, when it has one (reservations). */
  total: number | null;
  lastSyncedAt: Date | string | null;
  lastError: string | null;
  createdAt: Date | string;
  /** When the current pass started, kept in the job's progress. */
  startedAt: string | null;
  /** Guest profiles: the size of the list, kept in the job's progress. */
  progressTotal: number | null;
  /** Set once the first complete pass has finished. */
  initialComplete: boolean;
  /** Size of the last complete pass. */
  snapshotTotal: number | null;
  /** Reservations that could not be brought in (an unmapped room type or an unknown status). */
  skipped?: number;
}

export type SyncGroupState = 'done' | 'running' | 'waiting' | 'error';

export interface SyncGroup {
  key: 'catalog' | 'availability' | 'bookings' | 'guests' | 'money';
  label: string;
  /** What this part brings in, in one plain sentence. */
  hint: string;
  total: number | null;
  done: number;
  remaining: number | null;
  state: SyncGroupState;
  /** Items finished per minute since this part started, when it can be measured. */
  ratePerMinute: number | null;
  /** Seconds until this part is finished, when it can be estimated. */
  etaSeconds: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Items left out on purpose, with the reason in the hint of the screen. */
  skipped: number;
  /** What is held right now, in one sentence, for example "13 room types, 150 rooms and 26 rates". */
  detail: string | null;
}

/** What the database holds for this hotel, so each part can say exactly what it contains. */
export interface SyncCounts {
  guestProfiles?: number;
  roomTypes?: number;
  rooms?: number;
  rates?: number;
  bookingsByStatus?: Record<string, number>;
  /** Earliest stay date of an imported reservation (YYYY-MM-DD). */
  earliestStay?: string | null;
}

const plural = (n: number, one: string, many = one + 's') =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

export interface SyncSummary {
  groups: SyncGroup[];
  /** The whole picture: share finished, and the longest estimate among the parts still running. */
  overall: { percent: number; state: SyncGroupState; etaSeconds: number | null };
}

const asDate = (value: Date | string | null): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const iso = (value: Date | string | null) => asDate(value)?.toISOString() ?? null;
const latest = (values: Array<Date | string | null>) =>
  values
    .map(asDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())
    .at(-1) ?? null;

/** Items per minute, and the seconds left at that speed. Needs at least a little history to be honest. */
function pace(done: number, remaining: number | null, since: Date | null, now: Date) {
  if (!since || done <= 0 || remaining === null) return { rate: null, eta: null };
  const minutes = (now.getTime() - since.getTime()) / 60000;
  if (minutes < 0.5) return { rate: null, eta: null };
  const rate = done / minutes;
  if (rate <= 0) return { rate: null, eta: null };
  return { rate: Math.round(rate * 10) / 10, eta: Math.round((remaining / rate) * 60) };
}

function stateOf(jobs: SyncJobRow[], finished: boolean): SyncGroupState {
  if (jobs.some((j) => j.status === 'FAILED')) return 'error';
  if (finished) return 'done';
  return jobs.some((j) => j.status === 'RUNNING' || j.processed > 0) ? 'running' : 'waiting';
}

function listGroup(
  key: 'bookings' | 'guests',
  label: string,
  hint: string,
  job: SyncJobRow | undefined,
  now: Date,
  held = 0,
  detail: string | null = null,
): SyncGroup {
  if (!job)
    return {
      key,
      label,
      hint,
      total: null,
      done: 0,
      remaining: null,
      state: 'waiting',
      ratePerMinute: null,
      etaSeconds: null,
      lastSyncedAt: null,
      lastError: null,
      skipped: 0,
      detail,
    };
  // After the first full pass the job only picks up changes, so the figure to show is that full pass.
  if (job.initialComplete) {
    const total = Math.max(job.snapshotTotal ?? job.total ?? job.processed, held);
    return {
      key,
      label,
      hint,
      total,
      done: total,
      remaining: 0,
      state: job.status === 'FAILED' ? 'error' : 'done',
      ratePerMinute: null,
      etaSeconds: null,
      lastSyncedAt: iso(job.lastSyncedAt),
      lastError: job.lastError,
      skipped: job.skipped ?? 0,
      detail,
    };
  }
  const total = job.total ?? job.progressTotal;
  const done = job.processed;
  const remaining = total === null ? null : Math.max(0, total - done);
  const { rate, eta } = pace(done, remaining, asDate(job.startedAt) ?? asDate(job.createdAt), now);
  return {
    key,
    label,
    hint,
    total,
    done,
    remaining,
    state: stateOf([job], false),
    ratePerMinute: rate,
    etaSeconds: eta,
    lastSyncedAt: iso(job.lastSyncedAt),
    lastError: job.lastError,
    skipped: job.skipped ?? 0,
    detail,
  };
}

/** Turns the raw job rows into the parts a hotel owner understands: what is coming in, how much, how fast. */
export function buildSyncSummary(
  jobs: SyncJobRow[],
  now = new Date(),
  counts: SyncCounts = {},
): SyncSummary {
  const by = (resource: string) => jobs.find((j) => j.resource === resource);
  const setup = ['catalog', 'rooms', 'rates']
    .map(by)
    .filter((j): j is SyncJobRow => j !== undefined);
  const availability = jobs.filter((j) => j.resource.startsWith('availability:'));
  const money = jobs.filter((j) => j.resource.startsWith('financial:'));

  const setupDone = setup.filter((j) => j.lastSyncedAt).length;
  const availabilityDone = availability.filter((j) => j.lastSyncedAt).length;
  const moneyDone = money.filter((j) => j.lastSyncedAt).length;
  const moneyStart = asDate(
    money
      .map((j) => asDate(j.createdAt))
      .sort((a, b) => (a?.getTime() ?? 0) - (b?.getTime() ?? 0))[0] ?? null,
  );
  const availabilityStart = asDate(
    availability
      .map((j) => asDate(j.createdAt))
      .sort((a, b) => (a?.getTime() ?? 0) - (b?.getTime() ?? 0))[0] ?? null,
  );
  const moneyPace = pace(moneyDone, money.length - moneyDone, moneyStart, now);
  const availabilityPace = pace(
    availabilityDone,
    availability.length - availabilityDone,
    availabilityStart,
    now,
  );

  const status = counts.bookingsByStatus ?? {};
  const held = Object.values(status).reduce((sum, n) => sum + n, 0);
  const reservationDetail = held
    ? `${plural(held, 'reservation')} held: ${plural(status.CONFIRMED ?? 0, 'confirmed', 'confirmed')}, ${plural(
        status.CANCELLED ?? 0,
        'cancelled',
        'cancelled',
      )}${counts.earliestStay ? `; the earliest stay is ${counts.earliestStay}` : ''}.`
    : null;
  const catalogDetail =
    counts.roomTypes !== undefined
      ? `${plural(counts.roomTypes, 'room type')}, ${plural(counts.rooms ?? 0, 'room')} and ${plural(
          counts.rates ?? 0,
          'rate',
        )}.`
      : null;
  const availabilityDetail = availability.length
    ? `${plural(availability.length, 'month')} of free rooms for ${plural(
        counts.roomTypes ?? 0,
        'room type',
      )}.`
    : null;
  const guestDetail =
    counts.guestProfiles !== undefined
      ? `${plural(counts.guestProfiles, 'guest profile')} held.`
      : null;
  const moneyDetail = money.length
    ? `${plural(moneyDone, 'bill')} checked of ${money.length.toLocaleString('en-GB')} current and recent reservations.`
    : null;

  const groups: SyncGroup[] = [
    {
      key: 'catalog',
      label: 'Room types, rooms and rates',
      hint: 'The hotel’s rooms and the rates Clock offers for them.',
      total: setup.length || null,
      done: setupDone,
      remaining: setup.length ? setup.length - setupDone : null,
      state: stateOf(setup, setup.length > 0 && setupDone === setup.length),
      ratePerMinute: null,
      etaSeconds: null,
      lastSyncedAt: iso(latest(setup.map((j) => j.lastSyncedAt))),
      lastError: setup.find((j) => j.lastError)?.lastError ?? null,
      skipped: 0,
      detail: catalogDetail,
    },
    {
      key: 'availability',
      label: 'Availability',
      hint: 'Free rooms per day for the next 12 months.',
      total: availability.length || null,
      done: availabilityDone,
      remaining: availability.length ? availability.length - availabilityDone : null,
      state: stateOf(
        availability,
        availability.length > 0 && availabilityDone === availability.length,
      ),
      ratePerMinute: availabilityPace.rate,
      etaSeconds: availabilityPace.eta,
      lastSyncedAt: iso(latest(availability.map((j) => j.lastSyncedAt))),
      lastError: availability.find((j) => j.lastError)?.lastError ?? null,
      skipped: 0,
      detail: availabilityDetail,
    },
    listGroup(
      'bookings',
      'Reservations',
      'Every reservation in Clock since the account began: past, current and future.',
      by('bookings'),
      now,
      0,
      reservationDetail,
    ),
    listGroup(
      'guests',
      'Guest profiles',
      'Every guest profile in Clock.',
      by('guests'),
      now,
      counts.guestProfiles ?? 0,
      guestDetail,
    ),
    {
      key: 'money',
      label: 'Bills and payments',
      hint: 'What each current and recent reservation owes and has paid. Older reservations load their bill when opened.',
      total: money.length || null,
      done: moneyDone,
      remaining: money.length ? money.length - moneyDone : null,
      state: stateOf(money, money.length > 0 && moneyDone === money.length),
      ratePerMinute: moneyPace.rate,
      etaSeconds: moneyPace.eta,
      lastSyncedAt: iso(latest(money.map((j) => j.lastSyncedAt))),
      lastError: money.find((j) => j.lastError)?.lastError ?? null,
      skipped: 0,
      detail: moneyDetail,
    },
  ];

  const counted = groups.filter((g) => g.total !== null && g.total > 0);
  const totalItems = counted.reduce((sum, g) => sum + (g.total ?? 0), 0);
  const doneItems = counted.reduce((sum, g) => sum + Math.min(g.done, g.total ?? 0), 0);
  const etas = groups
    .filter((g) => g.state !== 'done')
    .map((g) => g.etaSeconds)
    .filter((e): e is number => e !== null);
  const state: SyncGroupState = groups.some((g) => g.state === 'error')
    ? 'error'
    : groups.every((g) => g.state === 'done')
      ? 'done'
      : groups.some((g) => g.state === 'running')
        ? 'running'
        : 'waiting';
  return {
    groups,
    overall: {
      percent: totalItems ? Math.floor((doneItems / totalItems) * 100) : 0,
      state,
      etaSeconds: etas.length ? Math.max(...etas) : null,
    },
  };
}
