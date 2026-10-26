import { describe, expect, it } from 'vitest';

import {
  autoOverviewType,
  resolveOverviewType,
  visibleWidgets,
  widgetsForPreview,
} from './overview-widgets';

describe('Overview by permission', () => {
  it('maps owners, admins and the built-in roles to fixed types', () => {
    expect(resolveOverviewType({ tenantRole: 'OWNER', capabilities: [] })).toBe('owner_manager');
    expect(resolveOverviewType({ tenantRole: 'ADMIN', capabilities: [] })).toBe('owner_manager');
    const staff = (roleName: string) =>
      resolveOverviewType({
        tenantRole: 'STAFF',
        roleName,
        roleKind: 'BUILT_IN',
        capabilities: [],
      });
    expect(staff('Front Desk')).toBe('front_desk');
    expect(staff('Finance')).toBe('finance');
    expect(staff('Property Manager')).toBe('owner_manager');
  });

  it('picks the closest type for an automatic custom role', () => {
    expect(autoOverviewType(['payments.view', 'reports.view'])).toBe('owner_manager');
    expect(autoOverviewType(['payments.view', 'refunds'])).toBe('finance');
    expect(autoOverviewType(['payments.view', 'bookings.create'])).toBe('reservations');
    expect(autoOverviewType(['bookings.edit', 'calendar.view'])).toBe('front_desk');
    expect(autoOverviewType(['bookings.create'])).toBe('reservations');
    expect(autoOverviewType(['guests.view'])).toBe('minimal');
  });

  it('uses the stored type of a custom role and falls back to automatic for unknown values', () => {
    const base = {
      tenantRole: 'STAFF' as const,
      roleKind: 'CUSTOM' as const,
      capabilities: ['bookings.create'],
    };
    expect(resolveOverviewType({ ...base, storedType: 'finance' })).toBe('finance');
    expect(resolveOverviewType({ ...base, storedType: 'auto' })).toBe('reservations');
    expect(resolveOverviewType({ ...base, storedType: 'nonsense' })).toBe('reservations');
  });

  it('never shows a widget the person lacks permission for, whatever the type', () => {
    const noMoney = visibleWidgets('owner_manager', ['bookings.view', 'calendar.view']);
    expect(noMoney).toContain('tile.arrivals');
    expect(noMoney).not.toContain('tile.collectedToday');
    expect(noMoney).not.toContain('tile.dueAtDesk');
    const nothing = visibleWidgets('owner_manager', []);
    expect(nothing).toEqual(['panel.myTasks']);
    expect(visibleWidgets('finance', ['payments.view'])).toEqual([
      'tile.collectedToday',
      'panel.myTasks',
    ]);
  });

  it('hides sold-out rooms for Clock hotels, where MUST does not know the supply', () => {
    const caps = ['bookings.view', 'calendar.view'];
    expect(visibleWidgets('front_desk', caps, { source: 'LOCAL' })).toContain('list.soldOut');
    expect(visibleWidgets('front_desk', caps, { source: 'CLOCK' })).not.toContain('list.soldOut');
  });

  it('previews what a role would see and which widgets its permissions hide', () => {
    const preview = widgetsForPreview('owner_manager', ['bookings.view']);
    expect(preview.shown).toContain('list.arrivals');
    expect(preview.hidden).toContain('tile.collectedToday');
    expect(
      widgetsForPreview('auto', ['bookings.view', 'bookings.edit', 'calendar.view']).resolved,
    ).toBe('front_desk');
  });
});
