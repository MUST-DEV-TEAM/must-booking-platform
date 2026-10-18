export type HouseRulesSource = 'room' | 'room-type' | null;

export type EffectiveHouseRules = {
  effectiveRules: string | null;
  rulesSource: HouseRulesSource;
};

/** Resolves the guest-facing house rules for a room from its own text or its room type. */
export function resolveEffectiveHouseRules(
  roomRules: string | null | undefined,
  roomTypeRules: string | null | undefined,
): EffectiveHouseRules {
  const ownRules = normalizeRules(roomRules);
  if (ownRules) return { effectiveRules: ownRules, rulesSource: 'room' };

  const inheritedRules = normalizeRules(roomTypeRules);
  if (inheritedRules) return { effectiveRules: inheritedRules, rulesSource: 'room-type' };

  return { effectiveRules: null, rulesSource: null };
}

function normalizeRules(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}
