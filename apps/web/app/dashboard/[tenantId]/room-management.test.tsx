// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoomManagement } from './room-management';
import { DashboardQueryProvider } from '../query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

function accommodationFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/properties'))
      return new Response(JSON.stringify([{ id: 'property-1', name: 'Hotel' }]));
    if (url.endsWith('/properties/property-1/room-types'))
      return new Response(
        JSON.stringify([
          {
            id: 'room-type-1',
            name: 'Double',
            description: 'A quiet double room',
            amenitiesIntro: null,
            mainImageUrl: null,
            galleryImageUrls: [],
            maxOccupancy: 2,
          },
        ]),
      );
    if (url.endsWith('/properties/property-1/amenities'))
      return new Response(JSON.stringify([{ id: 'amenity-1', name: 'Wi-Fi', icon: 'WIFI' }]));
    if (url.endsWith('/room-types/room-type-1/rooms'))
      return new Response(
        JSON.stringify([
          {
            id: 'room-1',
            name: '101',
            title: 'Garden room',
            roomSize: '24 m²',
            rules: null,
            description: null,
            floor: 1,
            viewType: 'Garden view',
          },
        ]),
      );
    if (url.endsWith('/room-types/room-type-1/amenities'))
      return new Response(JSON.stringify([{ id: 'amenity-1', name: 'Wi-Fi', icon: 'WIFI' }]));
    if (url.endsWith('/rooms/room-1/amenities')) return new Response(JSON.stringify([]));
    return new Response(JSON.stringify([]));
  });
}

describe('RoomManagement', () => {
  it('uses shared loading skeletons during the initial load', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(RoomManagement, { tenantId: 'tenant-1' }),
      ),
    );
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Accommodations');
    expect(markup).toContain('data-slot="skeleton"');
  });

  it('shows room-type and room lists with a quick peek from fetched data', async () => {
    const fetch = accommodationFetch();
    vi.stubGlobal('fetch', fetch);
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(RoomManagement, {
            tenantId: 'tenant-1',
            propertyId: 'property-1',
            canManagePhotos: false,
          }),
        ),
      ),
    );
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Double'))
          throw new Error('Room types have not finished loading yet.');
      });
    });

    expect(container.textContent).toContain('Accommodations');
    expect(container.textContent).toContain('Room types');
    expect(container.textContent).toContain('2');
    expect(container.textContent).not.toContain('Manage photos');
    expect(
      fetch.mock.calls.some(([url]) => String(url).endsWith('/room-types/room-type-1/images')),
    ).toBe(false);

    const roomsTab = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      tab.textContent?.includes('Rooms'),
    );
    expect(roomsTab).toBeDefined();
    await act(async () => (roomsTab as HTMLElement).click());
    expect(container.textContent).toContain('101');
    expect(container.textContent).toContain('Garden view');

    const roomButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '101',
    );
    expect(roomButton).toBeDefined();
    await act(async () => (roomButton as HTMLButtonElement).click());
    expect(document.body.textContent).toContain('Room details');
    expect(document.body.textContent).toContain('Garden room');
    await act(async () => root.unmount());
  });

  it('keeps photo loading and management out when photos.manage is absent', async () => {
    const photoUrl = '/api/tenants/tenant-1/properties/property-1/room-types/room-type-1/images';
    const fetch = accommodationFetch();
    vi.stubGlobal('fetch', fetch);
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(RoomManagement, {
            tenantId: 'tenant-1',
            propertyId: 'property-1',
            canManagePhotos: false,
          }),
        ),
      ),
    );
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Double'))
          throw new Error('Room types have not finished loading yet.');
      });
    });
    expect(fetch.mock.calls.some(([url]) => String(url) === photoUrl)).toBe(false);
    expect(container.textContent).not.toContain('Photo library');
    expect(container.textContent).not.toContain('Manage photos');
    await act(async () => root.unmount());
  });
});
