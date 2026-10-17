export type StaffTemplate = {
  id: string;
  name: string;
  kind: 'BUILT_IN' | 'CUSTOM';
  description: string | null;
  capabilities: string[];
  memberCount: number;
};

export type StaffMember = {
  userId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  roleTemplateId: string;
  roleTemplateName: string;
  overrides: Array<{ capabilityKey: string; granted: boolean }>;
  status: 'ACTIVE' | 'SUSPENDED';
  lastActiveAt: string | null;
  createdAt?: string;
  createdByEmail?: string | null;
};

export type StaffStats = {
  baseCapabilities: number;
  overrides: number;
  grantedOverrides: number;
  revokedOverrides: number;
};

/** Figures shown for a staff account, derived from its existing role and override data. */
export function staffStats(member: StaffMember, template?: StaffTemplate): StaffStats {
  return {
    baseCapabilities: template?.capabilities.length ?? 0,
    overrides: member.overrides.length,
    grantedOverrides: member.overrides.filter((override) => override.granted).length,
    revokedOverrides: member.overrides.filter((override) => !override.granted).length,
  };
}
