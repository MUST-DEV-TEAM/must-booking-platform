// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookingReviewCard, checkMessage } from './booking-review-card';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};
async function mount(canRunCheck = true) {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(BookingReviewCard, {
          tenantId: 't',
          propertyId: 'p',
          bookingId: 'b',
          canRunCheck,
        }),
      ),
    );
    await settle();
  });
  await act(settle);
}

describe('booking review card', () => {
  it('stays hidden for a booking that does not need review', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ needsReview: false, canCheck: true, reasons: [] })),
    );
    await mount();
    expect(document.body.textContent).toBe('');
  });

  it('explains the problem in plain words and runs a read-only check', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ result: 'not_found' })
        : Response.json({
            needsReview: true,
            canCheck: true,
            reasons: [
              {
                text: 'The property system did not confirm this booking.',
                openedAt: '2026-10-20T10:00:00Z',
              },
            ],
          }),
    );
    vi.stubGlobal('fetch', fetch);
    await mount();
    expect(document.body.textContent).toContain('This booking needs review');
    expect(document.body.textContent).toContain('did not confirm this booking');
    const run = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Run check',
    )!;
    await act(async () => {
      run.click();
      await settle();
    });
    expect(
      fetch.mock.calls.some(
        ([url, init]) => url.endsWith('/review/check') && init?.method === 'POST',
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain('does not have this booking');
  });

  it('hides the Run check button without permission or without an external system', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ needsReview: true, canCheck: true, reasons: [] })),
    );
    await mount(false);
    expect(
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Run check'),
    ).toBe(false);
  });

  it('words each check outcome so nobody retries blindly', () => {
    expect(checkMessage({ result: 'found', clockBookingId: '1', linked: true })).toContain(
      'matches our record',
    );
    expect(checkMessage({ result: 'found', clockBookingId: '1', linked: false })).toContain(
      'Do not create it again',
    );
    expect(checkMessage({ result: 'unavailable', message: 'Clock could not be reached.' })).toBe(
      'Clock could not be reached.',
    );
  });
});
