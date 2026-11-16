import { describe, expect, it, vi } from 'vitest';

import {
  ClockPermissionsMonitorService,
  accessLostReason,
  blockedRights,
} from './clock-permissions-monitor.service';
import type { ClockPermissionReport } from './clock-permissions.service';

type Status = 'allowed' | 'missing' | 'pending';
const entry = (id: string, status: Status, right?: string) => ({
  id,
  name: id,
  probeable: true,
  status,
  ...(right ? { right } : {}),
});
const report = (
  checkedAt: string | null,
  rows: Array<ReturnType<typeof entry>>,
): ClockPermissionReport =>
  ({ sandbox: false, features: [], checkedAt, entries: rows, missingRights: [] }) as never;

const ROOMS = 'GET pms_api/rooms/';
const PLANS = 'GET pms_api/rate_plans/';

function setup(before: ClockPermissionReport, after: ClockPermissionReport) {
  const permissions = {
    report: vi.fn().mockResolvedValue(before),
    check: vi.fn().mockResolvedValue(after),
  };
  const notifications = { record: vi.fn().mockResolvedValue(undefined) };
  const service = Object.assign(Object.create(ClockPermissionsMonitorService.prototype), {
    permissions,
    notifications,
    logger: { warn: vi.fn(), log: vi.fn() },
  }) as ClockPermissionsMonitorService;
  return { service, permissions, notifications };
}

const scope = { tenantId: 't1', propertyId: 'p1' };

describe('ClockPermissionsMonitorService', () => {
  it('alerts the owners when a right a feature depends on has newly gone missing', async () => {
    const { service, notifications } = setup(
      report('2026-10-25T10:00:00Z', [entry(ROOMS, 'allowed')]),
      report('2026-10-26T10:00:00Z', [entry(ROOMS, 'missing', 'pms_api_rooms_index')]),
    );

    await expect(service.checkProperty(scope)).resolves.toBe(true);

    expect(notifications.record).toHaveBeenCalledWith('t1', 'p1', 'CLOCK_RIGHT_MISSING', {
      rights: ['pms_api_rooms_index'],
      features: ['Importing rooms and room types'],
    });
  });

  it('stays quiet when nothing changed, so a known gap is not repeated every day', async () => {
    const missing = report('2026-10-25T10:00:00Z', [
      entry(ROOMS, 'missing', 'pms_api_rooms_index'),
    ]);
    const { service, notifications } = setup(missing, missing);

    await expect(service.checkProperty(scope)).resolves.toBe(false);
    expect(notifications.record).not.toHaveBeenCalled();
  });

  it('on a first check only alerts for features the hotel cannot run without', async () => {
    const optional = setup(
      report(null, [entry(PLANS, 'pending')]),
      report('2026-10-26T10:00:00Z', [entry(PLANS, 'missing', 'pms_api_rate_plans_index')]),
    );
    await expect(optional.service.checkProperty(scope)).resolves.toBe(false);

    const required = setup(
      report(null, [entry(ROOMS, 'pending')]),
      report('2026-10-26T10:00:00Z', [entry(ROOMS, 'missing', 'pms_api_rooms_index')]),
    );
    await expect(required.service.checkProperty(scope)).resolves.toBe(true);
  });

  it('checks in batches of twelve and only the requests that can be checked', async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      entry(`GET pms_api/x${index}`, 'pending'),
    );
    const { service, permissions } = setup(
      report('2026-10-25T10:00:00Z', [
        ...many,
        { ...entry('POST pms_api/rooms', 'pending'), probeable: false },
      ]),
      report(
        '2026-10-26T10:00:00Z',
        many.map((row) => ({ ...row, status: 'allowed' as const })),
      ),
    );

    await service.checkProperty(scope);

    expect(permissions.check).toHaveBeenCalledTimes(3);
    expect(permissions.check.mock.calls[0]?.[2]).toHaveLength(12);
    expect(permissions.check.mock.calls[2]?.[2]).toHaveLength(6);
  });
});

describe('blockedRights', () => {
  it('names the features each missing right blocks', () => {
    const blocked = blockedRights(
      report('x', [entry(ROOMS, 'missing', 'pms_api_rooms_index'), entry(PLANS, 'missing')]),
      false,
    );
    expect(blocked.get('pms_api_rooms_index')).toEqual(['Importing rooms and room types']);
    expect(blocked.size).toBe(2);
    expect(blockedRights(report('x', [entry(PLANS, 'missing')]), true).size).toBe(0);
  });
});

describe('access lost (expired trial, disabled API user)', () => {
  const TRIAL = 'The trial period of this account has expired.';
  const refusedAll = (checkedAt: string) =>
    report(
      checkedAt,
      Array.from({ length: 12 }, (_, index) => ({
        ...entry(`GET pms_api/thing${index}/`, 'missing'),
        message: TRIAL,
      })),
    );
  const healthy = (checkedAt: string) =>
    report(
      checkedAt,
      Array.from({ length: 12 }, (_, index) => entry(`GET pms_api/thing${index}/`, 'allowed')),
    );

  it('tells the hotel once, with the reason Clock gave, when everything starts being refused', async () => {
    const { service, notifications } = setup(
      healthy('2026-11-15T14:00:00Z'),
      refusedAll('2026-11-16T14:00:00Z'),
    );

    await expect(service.checkProperty(scope)).resolves.toBe(true);

    expect(notifications.record).toHaveBeenCalledTimes(1);
    expect(notifications.record).toHaveBeenCalledWith('t1', 'p1', 'CLOCK_ACCESS_LOST', {
      reason: TRIAL,
    });
  });

  it('does not repeat while access stays lost, and does not list every missing right', async () => {
    const { service, notifications } = setup(
      refusedAll('2026-11-16T14:00:00Z'),
      refusedAll('2026-11-17T14:00:00Z'),
    );

    await expect(service.checkProperty(scope)).resolves.toBe(false);

    expect(notifications.record).not.toHaveBeenCalled();
  });

  it('is not access lost when a refusal names a right, when something is allowed, or when too little was checked', () => {
    const named = report(
      'x',
      Array.from({ length: 12 }, (_, i) => entry(`GET a${i}`, 'missing', 'some_right')),
    );
    const partlyAllowed = report('x', [
      ...Array.from({ length: 11 }, (_, i) => entry(`GET a${i}`, 'missing')),
      entry('GET b', 'allowed'),
    ]);
    const tooFew = report('x', [entry('GET a', 'missing'), entry('GET b', 'missing')]);
    expect(accessLostReason(named)).toBeNull();
    expect(accessLostReason(partlyAllowed)).toBeNull();
    expect(accessLostReason(tooFew)).toBeNull();
  });
});
