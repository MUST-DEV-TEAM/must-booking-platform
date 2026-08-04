import { describe, expect, it } from 'vitest';

import { CLOCK_QUEUE_NAMES, CLOCK_QUEUE_PRIORITY } from './clock-queue-names';

describe('CLOCK_QUEUE_PRIORITY', () => {
  it('orders every named queue per the source brief: critical commands, then webhooks, then operational sync, then reconciliation, then catalog sync last', () => {
    const priorityOf = (name: (typeof CLOCK_QUEUE_NAMES)[number]) => CLOCK_QUEUE_PRIORITY[name];

    expect(priorityOf('clock.critical.commands')).toBeLessThan(priorityOf('clock.webhooks'));
    expect(priorityOf('clock.webhooks')).toBeLessThan(priorityOf('clock.booking.sync'));
    expect(priorityOf('clock.webhooks')).toBeLessThan(priorityOf('clock.financial.sync'));
    expect(priorityOf('clock.booking.sync')).toBeLessThan(priorityOf('clock.reconciliation'));
    expect(priorityOf('clock.financial.sync')).toBeLessThan(priorityOf('clock.reconciliation'));
    expect(priorityOf('clock.reconciliation')).toBeLessThan(priorityOf('clock.catalog.sync'));
  });

  it('assigns a priority to every named queue, with no gaps', () => {
    for (const name of CLOCK_QUEUE_NAMES) {
      expect(typeof CLOCK_QUEUE_PRIORITY[name]).toBe('number');
    }
  });
});
