// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { AccommodationOverview } from './accommodation-overview';
import type { AccommodationActivity, RoomType } from './room-management-types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function roomType(id: string, name: string, complete: boolean): RoomType {
  return {
    id,
    name,
    description: null,
    amenitiesIntro: null,
    mainImageUrl: null,
    galleryImageUrls: [],
    maxOccupancy: 2,
    status: 'DRAFT',
    readiness: {
      checks: [{ key: 'basicInfo', label: 'Basic information', complete, fixLabel: 'Add details' }],
      completeCount: complete ? 1 : 0,
      missingCount: complete ? 0 : 1,
      isComplete: complete,
      firstFix: complete ? null : { key: 'basicInfo', label: 'Add details' },
    },
  };
}

function activity(id: string, targetId: string, createdAt: string): AccommodationActivity {
  return {
    id,
    actorUserId: 'owner-1',
    actorName: 'Hotel Owner',
    action: 'room_type_image.created',
    targetType: 'room_type_image',
    targetId,
    targetName: targetId === 'photo-1' ? 'Double Room' : `Room type ${targetId}`,
    details: { roomTypeId: `type-${targetId}` },
    createdAt,
  };
}

async function renderOverview(roomTypes: RoomType[], events: AccommodationActivity[]) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(AccommodationOverview, {
        roomTypes,
        activity: events,
        canFix: () => true,
        onFix: () => {},
      }),
    ),
  );
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('AccommodationOverview', () => {
  it('lists all room types with incomplete rows first and setup actions', async () => {
    const { container, root } = await renderOverview(
      [roomType('ready', 'Ready type', true), roomType('incomplete', 'Needs setup', false)],
      [],
    );
    const readinessCard = container.querySelector('[data-slot="card"]');
    const rows = [...(readinessCard?.querySelectorAll('.rounded-md.border') ?? [])].filter(
      (row) => row.textContent?.includes('Needs setup') || row.textContent?.includes('Ready type'),
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Needs setup'),
      expect.stringContaining('Ready type'),
    ]);
    expect(rows[0]?.textContent).toContain('1 missing');
    expect(readinessCard?.textContent).toContain('Add details');
    expect(rows[1]?.textContent).toContain('Complete');
    await act(async () => root.unmount());
  });

  it('collapses ready rows behind Show all and expands them on request', async () => {
    const { container, root } = await renderOverview(
      [roomType('ready-1', 'Ready one', true), roomType('ready-2', 'Ready two', true)],
      [],
    );
    expect(container.textContent).toContain('All room types are ready.');
    expect(container.textContent).not.toContain('Ready one');
    const showAll = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Show all',
    );
    expect(showAll).toBeDefined();
    await act(async () => (showAll as HTMLButtonElement).click());
    expect(container.textContent).toContain('Ready one');
    expect(container.textContent).toContain('Ready two');
    await act(async () => root.unmount());
  });

  it('groups repeated activity, shows eight rows first, then more', async () => {
    const baseTime = Date.now();
    const events = Array.from({ length: 5 }, (_, index) =>
      activity(`same-${index}`, 'photo-1', new Date(baseTime - index * 60_000).toISOString()),
    );
    events.push(
      ...Array.from({ length: 8 }, (_, index) =>
        activity(
          `other-${index}`,
          `photo-${index + 2}`,
          new Date(baseTime - (index + 6) * 60_000).toISOString(),
        ),
      ),
    );
    const { container, root } = await renderOverview([], events);
    const activityList = container.querySelectorAll('[data-slot="card"]')[1]?.querySelector('ol');
    expect(activityList?.querySelectorAll('li')).toHaveLength(9);
    expect(activityList?.textContent).toContain('Photos changed on Double Room');
    expect(activityList?.textContent).toContain('x5');
    expect(activityList?.textContent).toContain('Hotel Owner');
    const more = [...(activityList?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Show more',
    );
    expect(more).toBeDefined();
    await act(async () => (more as HTMLButtonElement).click());
    expect(activityList?.querySelectorAll('li')).toHaveLength(9);
    await act(async () => root.unmount());
  });
});
