// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GuestReview } from './guest-review';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const form = {
  hotel: { name: 'Empire Beach Resort', logoUrl: null, brandColour: null, websiteUrl: null },
  guestFirstName: 'Ada',
  stay: { startsOn: '2027-07-12', endsOn: '2027-07-15' },
  categories: [
    { key: 'cleanliness', label: 'Cleanliness' },
    { key: 'staff', label: 'Staff' },
  ],
  alreadySubmitted: false,
};

async function open(search: string, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  window.history.pushState({}, '', `/review${search}`);
  const host = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    createRoot(host).render(createElement(GuestReview));
  });
  return host;
}

const ok = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

const link = '?tenant=t&property=p&token=abcdefghijklmnopqrstuvwxyz';

function radio(host: HTMLElement, group: string, score: number) {
  return host.querySelector<HTMLElement>(
    `[role=radiogroup][aria-label="${group}"] [role=radio][aria-label^="${score} out of 5"]`,
  )!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('GuestReview', () => {
  it('explains an incomplete link without calling the server', async () => {
    const fetchMock = ok({});
    const host = await open('', fetchMock);
    expect(host.textContent).toContain('This link is incomplete');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps Send off until an overall score is chosen, then sends the scores and thanks the guest', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => form })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ saved: true }) });
    const host = await open(link, fetchMock);
    const send = () =>
      [...host.querySelectorAll('button')].find((b) =>
        /send my review/i.test(b.textContent ?? ''),
      )!;
    expect(send().disabled).toBe(true);

    await act(async () => radio(host, 'Overall experience', 4).click());
    await act(async () => radio(host, 'Cleanliness', 5).click());
    expect(send().disabled).toBe(false);
    await act(async () => send().click());

    const [, init] = fetchMock.mock.calls[1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      overall: 4,
      categories: { cleanliness: 5 },
      comment: null,
    });
    expect(host.textContent).toContain('Thank you, Ada!');
  });

  it('shows the thank-you straight away when the stay was already reviewed', async () => {
    const host = await open(link, ok({ ...form, alreadySubmitted: true }));
    expect(host.textContent).toContain('Thank you, Ada!');
    expect(host.textContent).not.toContain('Send my review');
  });

  it('says so when the link has expired', async () => {
    const host = await open(link, ok({ message: 'This review link has expired.' }, 410));
    expect(host.textContent).toContain('This link has expired');
  });
});
