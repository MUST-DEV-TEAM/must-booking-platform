// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GuestReviewReport } from './guest-review-report';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = {
  summary: {
    overall: { average: 4.5, count: 2 },
    categories: [
      { key: 'cleanliness', label: 'Cleanliness', average: 5, count: 2 },
      { key: 'food', label: 'Food', average: null, count: 0 },
    ],
  },
  items: [
    {
      id: 'r1',
      submittedAt: '2027-07-20T10:00:00.000Z',
      overall: 5,
      categories: { cleanliness: 5, food: null },
      comment: 'Lovely stay.',
      booking: {
        id: 'b1',
        reference: 'EBR-1',
        startsOn: '2027-07-12',
        endsOn: '2027-07-15',
        roomName: 'Deluxe Suite',
      },
      guest: { id: 'g1', name: 'Ada Lovelace', email: 'ada@guest.test' },
    },
  ],
};

async function mount(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }),
  );
  const host = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    createRoot(host).render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(GuestReviewReport, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
  // Let the data request finish and the page draw it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return host;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('GuestReviewReport', () => {
  it('shows the overall score, the categories and each review linked to its guest and reservation', async () => {
    const host = await mount(report);
    expect(host.textContent).toContain('4.5');
    expect(host.textContent).toContain('Based on 2 reviews');
    expect(host.textContent).toContain('No ratings');
    const links = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/dashboard/t?propertyId=p&section=guests&guest=g1');
    expect(links).toContain('/dashboard/t?propertyId=p&section=reservations&reservation=b1');
    expect(host.textContent).toContain('Lovely stay.');
  });

  it('says so when there are no reviews in the period', async () => {
    const host = await mount({ summary: { overall: null, categories: [] }, items: [] });
    expect(host.textContent).toContain('No reviews in this period');
  });
});
