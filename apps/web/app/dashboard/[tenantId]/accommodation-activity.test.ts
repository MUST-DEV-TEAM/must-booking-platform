import { describe, expect, it } from 'vitest';

import {
  activitySentence,
  formatActivityDate,
  formatRelativeActivityTime,
  groupActivityEvents,
} from './accommodation-activity';
import type { AccommodationActivity } from './room-management-types';

const now = new Date('2026-10-18T10:00:00.000Z');
function event(overrides: Partial<AccommodationActivity> = {}): AccommodationActivity {
  return {
    id: 'event-1',
    actorUserId: 'actor-1',
    actorName: 'Mira Kola',
    action: 'room_type_image.created',
    targetType: 'room_type_image',
    targetId: 'image-1',
    targetName: 'Double Room',
    details: {},
    createdAt: '2026-10-18T09:59:00.000Z',
    ...overrides,
  };
}

describe('accommodation activity presentation', () => {
  it('groups adjacent identical events from one actor and target within ten minutes', () => {
    const groups = groupActivityEvents([
      event({ id: 'newest', createdAt: '2026-10-18T09:59:00.000Z' }),
      event({ id: 'older', targetId: 'image-2', createdAt: '2026-10-18T09:50:00.000Z' }),
      event({
        id: 'other-target',
        targetId: 'image-2',
        targetName: 'Another Room Type',
        createdAt: '2026-10-18T09:49:00.000Z',
      }),
      event({
        id: 'too-old',
        createdAt: '2026-10-18T09:38:00.000Z',
      }),
    ]);
    expect(groups.map(({ count }) => count)).toEqual([2, 1, 1]);
    expect(groups[0]?.event.id).toBe('newest');
  });

  it('uses the room or category name in readable activity sentences', () => {
    expect(activitySentence(event())).toBe('Photos changed on Double Room');
    expect(activitySentence(event({ targetName: null }))).toBe('Room type photos changed');
    expect(activitySentence(event({ action: undefined as unknown as string }))).toBe(
      'Double Room updated',
    );
    expect(
      activitySentence(
        event({
          action: 'room_type.status_changed',
          targetName: 'Double Room',
          details: { to: 'PUBLISHED' },
        }),
      ),
    ).toBe('Double Room published');
    expect(
      activitySentence(
        event({ action: 'room.active_changed', targetName: 'Room 12', details: { to: false } }),
      ),
    ).toBe('Room 12 set inactive');
    expect(
      activitySentence(
        event({
          action: 'room_category.created',
          targetName: 'Suites',
          targetType: 'room_category',
        }),
      ),
    ).toBe('Category Suites created');
  });

  it('formats relative time and a full tooltip date', () => {
    expect(formatRelativeActivityTime('2026-10-18T09:58:00.000Z', now)).toBe('2 min ago');
    expect(formatRelativeActivityTime('not a date', now)).toBe('Unknown time');
    expect(formatActivityDate('not a date')).toBe('Unknown time');
  });
});
