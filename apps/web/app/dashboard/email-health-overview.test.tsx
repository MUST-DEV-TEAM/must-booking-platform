// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { EmailHealthOverview } from './email-health-overview';
it('opens exact rolling windows, failing topic, message and sender/suppression fixes', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    onDelivery = vi.fn(),
    onConfiguration = vi.fn(),
    onMessage = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(EmailHealthOverview, {
          onDelivery,
          onConfiguration,
          onMessage,
          data: {
            counts: [],
            days: 7,
            testTrafficExcluded: true,
            domainAuthentication: 'UNKNOWN',
            domainEvidence: {
              activeMode: 'DEFAULT',
              setupMode: 'RESEND',
              status: 'verified',
              checkedAt: '2026-10-20T12:00:00Z',
              spf: 'Provider verified',
              dkim: 'Provider verified',
              dmarc: 'TXT published; alignment not checked',
            },
            volume24h: 2,
            volume7d: 4,
            attempted7d: 3,
            bounceRate: 33.333,
            complaintRate: null,
            queued: 2,
            oldestQueued: '2026-10-01',
            suppressedAddresses: 1,
            actionNeeded: [
              {
                id: 'm',
                eventType: 'owner.alert',
                label: 'Owner alert',
                recipient: 'staff@example.test',
                status: 'FAILED',
                lastError: 'Invalid address',
                createdAt: '2026-10-01',
              },
            ],
            failingTopics: [{ topic: 'owner.alert', label: 'Owner alert', count: 2 }],
          },
        }),
      ),
    );
    const click = async (text: string) => {
      const b = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
      expect(b).toBeTruthy();
      await act(async () => b!.click());
    };
    await click('Volume - last 24 hours');
    expect(onDelivery).toHaveBeenLastCalledWith('all', undefined, 24);
    await click('Bounce rate');
    expect(onDelivery).toHaveBeenLastCalledWith('bounced', undefined, 168);
    await click('Queued / unsent');
    expect(onDelivery).toHaveBeenLastCalledWith('queued');
    await click('Open delivery');
    expect(onMessage).toHaveBeenLastCalledWith('m');
    await click('Owner alert2');
    expect(onDelivery).toHaveBeenLastCalledWith('problems', 'owner.alert');
    await click('Suppressed addresses');
    expect(onConfiguration).toHaveBeenCalled();
    expect(host.textContent).toContain('33.33%');
    expect(host.textContent).toContain('No attempts in this period');
    expect(host.textContent).not.toContain('Delivery health');
    expect(host.textContent).toContain('Saved custom domain (not active): provider verified');
    expect(host.textContent).toContain('TXT published; alignment not checked');
    expect(host.textContent).not.toContain('No provider domain check has been recorded');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
