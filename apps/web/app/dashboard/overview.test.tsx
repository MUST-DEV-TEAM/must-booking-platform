import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardOverview } from './overview';

describe('DashboardOverview', () => {
  it('renders an accessible skeleton before overview data is available', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardOverview, {
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        role: 'OWNER',
      }),
    );
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Loading overview');
    expect(markup).toContain('must-skeleton');
  });

  it('renders KPI, needs-attention, activity, and owner quick-action data', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardOverview, {
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        role: 'OWNER',
        initialOverview: {
          kpis: {
            date: '2026-08-02',
            arrivals: 2,
            departures: 1,
            inHouse: 4,
            bookedRoomNights: 5,
            availableRoomNights: 7,
            occupancyRate: 71,
          },
          needsAttention: [
            {
              id: 'booking-1',
              status: 'PAYMENT_FAILED',
              startsOn: '2026-08-02',
              endsOn: '2026-08-04',
              guestName: 'Ada Guest',
              guestEmail: 'ada@example.test',
              roomTypeName: 'Double room',
            },
          ],
          recentActivity: [
            {
              id: 'audit-1',
              action: 'booking.created',
              targetType: 'booking',
              targetId: 'booking-1',
              createdAt: '2026-08-02T10:00:00.000Z',
            },
          ],
        },
      }),
    );

    expect(markup).toContain('Arrivals');
    expect(markup).toContain('71%');
    expect(markup).toContain('Ada Guest');
    expect(markup).toContain('payment failed');
    expect(markup).toContain('booking created');
    expect(markup).toContain('New booking');
    expect(markup).toContain('Add staff');
  });
});
