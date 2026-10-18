import { describe, expect, it } from 'vitest';

import { resolveEffectiveHouseRules } from './effective-house-rules';

describe('resolveEffectiveHouseRules', () => {
  it('uses room type rules when a room has no own rules', () => {
    expect(resolveEffectiveHouseRules(null, '  No smoking.  ')).toEqual({
      effectiveRules: 'No smoking.',
      rulesSource: 'room-type',
    });
  });

  it('prefers a room override over room type rules', () => {
    expect(resolveEffectiveHouseRules('  Quiet hours after 10pm. ', 'No smoking.')).toEqual({
      effectiveRules: 'Quiet hours after 10pm.',
      rulesSource: 'room',
    });
  });

  it('returns room type rules when the room override is cleared', () => {
    expect(resolveEffectiveHouseRules('', 'No smoking.')).toEqual({
      effectiveRules: 'No smoking.',
      rulesSource: 'room-type',
    });
  });

  it('returns no rules when both values are empty', () => {
    expect(resolveEffectiveHouseRules('  ', null)).toEqual({
      effectiveRules: null,
      rulesSource: null,
    });
  });
});
