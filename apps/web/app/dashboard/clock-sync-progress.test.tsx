// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ClockSyncProgress, formatDuration, type SyncSummary } from './clock-sync-progress';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summary: SyncSummary = {
  overall: { percent: 6, state: 'running', etaSeconds: 5 * 3600 + 20 * 60 },
  groups: [
    {
      key: 'bookings',
      label: 'Reservations',
      hint: 'Every reservation in Clock since the account began.',
      total: 15926,
      done: 1000,
      remaining: 14926,
      state: 'running',
      ratePerMinute: 25,
      etaSeconds: 5 * 3600 + 20 * 60,
      lastSyncedAt: null,
      lastError: null,
      skipped: 12,
      detail: '15,926 reservations held: 5,200 confirmed, 1,800 cancelled.',
    },
    {
      key: 'catalog',
      label: 'Room types, rooms and rates',
      hint: 'The hotel’s rooms.',
      total: 3,
      done: 3,
      remaining: 0,
      state: 'done',
      ratePerMinute: null,
      etaSeconds: null,
      lastSyncedAt: '2026-10-26T15:00:00Z',
      lastError: null,
      skipped: 0,
      detail: '13 room types, 150 rooms and 26 rates.',
    },
  ],
};

describe('formatDuration', () => {
  it('writes estimates in a few honest words', () => {
    expect(formatDuration(20)).toBe('under a minute');
    expect(formatDuration(12 * 60)).toBe('about 12 min');
    expect(formatDuration(5 * 3600 + 20 * 60)).toBe('about 5 h 20 min');
    expect(formatDuration(3 * 3600)).toBe('about 3 h');
    expect(formatDuration(30 * 3600)).toBe('about 1 d 6 h');
  });
});

describe('ClockSyncProgress', () => {
  it('shows what is coming in, how much is left, how fast and how long', async () => {
    const onSyncNow = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      createRoot(container).render(
        <ClockSyncProgress summary={summary} enabled syncing={false} onSyncNow={onSyncNow} />,
      );
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Overall: 6%');
    expect(text).toContain('full import will take about 5 h 20 min more');
    expect(text).toContain('Reservations');
    expect(text).toContain('1,000 of 15,926 · 14,926 left');
    expect(text).toContain('25 per minute');
    expect(text).toContain('12 could not be brought in');
    expect(text).toContain('5,200 confirmed, 1,800 cancelled');
    expect(text).toContain('13 room types, 150 rooms and 26 rates.');
    expect(text).toContain('Room types, rooms and rates');
    expect(text).toContain('3 in total');
    expect(text).toContain('Up to date');
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('Synchronize now'))!
        .click();
    });
    expect(onSyncNow).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it('says so when synchronization is paused', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      createRoot(container).render(
        <ClockSyncProgress
          summary={summary}
          enabled={false}
          syncing={false}
          onSyncNow={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain('Automatic synchronization is paused');
    expect(
      [...container.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Synchronize now'),
      )!.disabled,
    ).toBe(true);
    container.remove();
  });
});
