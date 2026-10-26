import { describe, expect, it } from 'vitest';

import { staffStats, type StaffMember, type StaffTemplate } from './staff-stats';

const member: StaffMember = {
  userId: 'user-1',
  email: 'staff@example.test',
  roleTemplateId: 'role-1',
  roleTemplateName: 'Front Desk',
  overrides: [
    { capabilityKey: 'guests.manage', granted: true },
    { capabilityKey: 'bookings.manage', granted: false },
  ],
};

describe('staffStats', () => {
  it('derives role capability and extra-permission counts from the loaded staff data', () => {
    const template: StaffTemplate = {
      id: 'role-1',
      name: 'Front Desk',
      kind: 'BUILT_IN',
      description: null,
      capabilities: ['guests.manage', 'bookings.manage'],
      memberCount: 3,
    };

    expect(staffStats(member, template)).toEqual({
      baseCapabilities: 2,
      overrides: 2,
      grantedOverrides: 1,
      revokedOverrides: 1,
    });
  });

  it('keeps extra-permission totals when the assigned role is unavailable', () => {
    expect(staffStats(member)).toEqual({
      baseCapabilities: 0,
      overrides: 2,
      grantedOverrides: 1,
      revokedOverrides: 1,
    });
  });
});
