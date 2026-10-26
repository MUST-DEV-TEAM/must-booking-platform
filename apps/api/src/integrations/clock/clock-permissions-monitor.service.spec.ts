import { describe, expect, it, vi } from 'vitest';

import { ClockPermissionsMonitorService, blockedRights } from './clock-permissions-monitor.service';
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
