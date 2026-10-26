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
    expect(document.body.textContent).toContain('no matching reservation');
  });

  it('offers a note-required resolution only after an authoritative check', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
      Response.json(
        url.endsWith('/resolve')
          ? { ok: true }
          : init?.method === 'POST'
            ? { result: 'not_found' }
            : { needsReview: true, canCheck: true, canResolve: true, reasons: [] },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    await mount();
    expect(document.body.textContent).not.toContain('Close as not created');
    await act(async () => {
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Run check')!.click();
      await settle();
    });
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Close as not created',
    )!;
    expect(button.disabled).toBe(true);
    await act(async () => {
      const input = document.querySelector('input[aria-label="Resolution note"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Verified absent and unpaid',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      button.click();
      await settle();
    });
    expect(
      fetcher.mock.calls.some(
        ([url, init]) =>
          url.endsWith('/resolve') && JSON.parse(String(init?.body)).action === 'not_created',
      ),
    ).toBe(true);
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

  it.each(['stay', 'room'])(
    'verifies a pending %s change through its saved operation, then removes the warning',
    async (pendingChange) => {
      let pending = true;
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          pending = false;
          return Response.json({ ok: true });
        }
        return Response.json({
          needsReview: pending,
          canCheck: true,
          canResolve: true,
          pendingChange: pending ? pendingChange : null,
          reasons: [],
        });
      });
      vi.stubGlobal('fetch', fetcher);
      await mount();
      expect(document.body.textContent).not.toContain('Run check');
      const label = pendingChange === 'stay' ? 'Verify stay change' : 'Verify room move';
      await act(async () => {
        [...document.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
        await settle();
      });
      expect(
        fetcher.mock.calls.some(
          ([url, init]) =>
            url.endsWith(pendingChange === 'stay' ? '/amend-check' : '/room-move/check') &&
            init?.method === 'POST',
        ),
      ).toBe(true);
      expect(
        fetcher.mock.calls.some(
          ([url]) => url.endsWith('/review/check') || url.endsWith('/resolve'),
        ),
      ).toBe(false);
      expect(document.body.textContent).not.toContain('This booking needs review');
    },
  );
  it('keeps a failed change verification reviewable without falling back to generic linking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? Response.json({ message: 'Clock could not verify this change.' }, { status: 409 })
          : Response.json({
              needsReview: true,
              canCheck: true,
              canResolve: true,
              pendingChange: 'stay',
              reasons: [],
            }),
      ),
    );
    await mount();
    await act(async () => {
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent === 'Verify stay change')!
        .click();
      await settle();
    });
    expect(document.body.textContent).toContain('Clock could not verify this change.');
    expect(document.body.textContent).not.toContain('Link and synchronize booking');
    expect(document.body.textContent).not.toContain('Close as not created');
  });
  it('words each check outcome so nobody retries blindly', () => {
    expect(checkMessage({ result: 'found', clockBookingId: '1', linked: true })).toContain(
      'matching reservation',
    );
    expect(checkMessage({ result: 'found', clockBookingId: '1', linked: false })).toContain(
      'Do not create another reservation',
    );
    expect(checkMessage({ result: 'unavailable', message: 'Clock could not be reached.' })).toBe(
      'Clock could not be reached.',
    );
  });
});
