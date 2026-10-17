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
            status: 'PUBLISHED',
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
            isActive: true,
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
    expect(container.textContent).not.toContain('Add room type');
    expect(container.textContent).not.toContain('Manage amenities');
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

  it('exposes an accommodations.manage active toggle in the room table', async () => {
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
            canManageAccommodations: true,
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
    const roomsTab = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      tab.textContent?.includes('Rooms'),
    );
    await act(async () => (roomsTab as HTMLElement).click());
    const toggle = container.querySelector('[role="switch"][aria-label="Room 101 active"]');
    expect(toggle).not.toBeNull();
    await act(async () => (toggle as HTMLElement).click());
    await vi.waitFor(() => {
      const call = fetch.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/room-types/room-type-1/rooms/room-1') && init?.method === 'PATCH',
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ isActive: false });
    });
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

  it('quick-adds a suggested amenity with its mapped icon', async () => {
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
            canManageAccommodations: true,
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

    const manageAmenities = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Manage amenities',
    );
    expect(manageAmenities).toBeDefined();
    await act(async () => (manageAmenities as HTMLButtonElement).click());
    await act(async () => {
      await vi.waitFor(() => {
        if (!document.body.textContent?.includes('Suggested amenities'))
          throw new Error('Amenity dialog has not opened yet.');
      });
    });

    const hairDryer = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Hair dryer',
    );
    expect(hairDryer).toBeDefined();
    await act(async () => (hairDryer as HTMLButtonElement).click());
    await act(async () => {
      await vi.waitFor(() => {
        if (!fetch.mock.calls.some(([, init]) => init?.method === 'POST'))
          throw new Error('Suggested amenity has not been submitted yet.');
      });
    });
    const call = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ name: 'Hair dryer', icon: 'HAIR_DRYER' });
    await act(async () => root.unmount());
  });

  it('opens the room type profile from quick peek and switches its four tabs', async () => {
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
    const roomTypeName = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Double',
    );
    expect(roomTypeName).toBeDefined();
    await act(async () => (roomTypeName as HTMLButtonElement).click());
    const openDetails = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'Open full details',
    );
    expect(openDetails).toBeDefined();
    await act(async () => (openDetails as HTMLButtonElement).click());

    expect(container.textContent).toContain('Room type profile and guest-facing setup.');
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Rooms1',
      'Photos',
      'Amenities1',
    ]);
    const photosTab = [...container.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent === 'Photos',
    );
    await act(async () => (photosTab as HTMLElement).click());
    expect(container.textContent).toContain('Photo access is not available');
    const roomsTab = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      tab.textContent?.startsWith('Rooms'),
    );
    await act(async () => (roomsTab as HTMLElement).click());
    expect(container.textContent).toContain('101');
    const amenitiesTab = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      tab.textContent?.startsWith('Amenities'),
    );
    await act(async () => (amenitiesTab as HTMLElement).click());
    expect(container.textContent).toContain('Wi-Fi');
    await act(async () => root.unmount());
  });

  it('duplicates room type fields and amenities without copying rooms or photos', async () => {
    const baseFetch = accommodationFetch();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/properties/property-1/room-types') && init?.method === 'POST')
        return new Response(
          JSON.stringify({
            id: 'room-type-copy',
            name: 'Double (copy)',
            description: 'A quiet double room',
            amenitiesIntro: null,
            mainImageUrl: null,
            galleryImageUrls: [],
            maxOccupancy: 2,
          }),
        );
      if (url.endsWith('/room-types/room-type-copy/amenities') && init?.method === 'PUT')
        return new Response(JSON.stringify([{ id: 'amenity-1', name: 'Wi-Fi', icon: 'WIFI' }]));
      return baseFetch(input);
    });
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
            canManageAccommodations: true,
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

    const actions = [...container.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Room type actions',
    );
    expect(actions).toBeDefined();
    await act(async () => {
      (actions as HTMLButtonElement).dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    const duplicate = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (button) => button.textContent?.trim() === 'Duplicate room type',
    );
    expect(duplicate).toBeDefined();
    await act(async () => (duplicate as HTMLElement).click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      await vi.waitFor(() => {
        if (
          !fetch.mock.calls.some(
            ([url, init]) =>
              String(url).endsWith('/room-types/room-type-copy/amenities') &&
              init?.method === 'PUT',
          )
        )
          throw new Error('Room type amenities have not been copied yet.');
      });
    });

    const createCall = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: 'Double (copy)',
      description: 'A quiet double room',
      amenitiesIntro: null,
      maxOccupancy: 2,
    });
    const amenityCall = fetch.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/room-types/room-type-copy/amenities') && init?.method === 'PUT',
    );
    expect(JSON.parse(String(amenityCall?.[1]?.body))).toEqual({ amenityIds: ['amenity-1'] });
    expect(
      fetch.mock.calls.some(([url]) => String(url).endsWith('/room-types/room-type-copy/rooms')),
    ).toBe(false);
    expect(
      fetch.mock.calls.some(([url]) => String(url).endsWith('/room-types/room-type-copy/images')),
    ).toBe(false);
    await act(async () => root.unmount());
  });
});
