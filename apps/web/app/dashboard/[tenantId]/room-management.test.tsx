// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoomManagement } from './room-management';
import { DashboardQueryProvider } from '../query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

describe('RoomManagement', () => {
  it('uses the shared dashboard skeleton during its initial load', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(RoomManagement, { tenantId: 'tenant-1' }),
      ),
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Loading rooms');
    expect(markup).toContain('must-skeleton');
  });

  it('does not load or expose photo actions without photos.manage', async () => {
    const photoUrl = '/api/tenants/tenant-1/properties/property-1/room-types/room-type-1/images';
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/properties')) return new Response(JSON.stringify([{ id: 'property-1', name: 'Hotel' }]));
      if (url.endsWith('/room-types')) return new Response(JSON.stringify([{
        id: 'room-type-1', name: 'Double', description: null, amenitiesIntro: null,
        mainImageUrl: null, galleryImageUrls: [], maxOccupancy: 2,
      }]));
      return new Response(JSON.stringify([]));
    });
    vi.stubGlobal('fetch', fetch);
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(createElement(DashboardQueryProvider, undefined,
      createElement(RoomManagement, { tenantId: 'tenant-1', propertyId: 'property-1', canManagePhotos: false }),
    )));
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Configured room types')) throw new Error('Room types have not finished loading yet.');
      });
    });
    expect(fetch.mock.calls.some(([url]) => url === photoUrl)).toBe(false);
    expect(container.textContent).not.toContain('Manage library');
    expect(container.textContent).not.toContain('Manage photos');
    await act(async () => root.unmount());
  });
});
