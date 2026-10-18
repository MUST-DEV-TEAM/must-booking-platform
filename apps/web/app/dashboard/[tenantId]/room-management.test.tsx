// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoomManagement } from './room-management';
import { RoomEditorDialog } from './room-management-dialogs';
import { DashboardQueryProvider } from '../query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function accommodationFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
            rules: 'No smoking in this room type.',
            mainImageUrl: null,
            galleryImageUrls: [],
            maxOccupancy: 2,
            status: 'PUBLISHED',
            categoryId: 'category-1',
            categoryName: 'Suites',
            readiness: {
              checks: [
                {
                  key: 'basicInfo',
                  label: 'Basic information',
                  complete: false,
                  fixLabel: 'Add details',
                },
              ],
              completeCount: 5,
              missingCount: 2,
              isComplete: false,
              firstFix: { key: 'basicInfo', label: 'Add details' },
            },
          },
        ]),
      );
    if (url.endsWith('/room-categories') && !init?.method)
      return new Response(
        JSON.stringify([
          {
            id: 'category-1',
            name: 'Suites',
            description: 'Large rooms',
            sortOrder: 0,
            storefrontVisible: true,
            roomCount: 1,
          },
        ]),
      );
    if (url.endsWith('/audit-logs'))
      return new Response(
        JSON.stringify([
          {
            id: 'audit-1',
            actorUserId: 'user-1',
            actorName: 'Hotel Owner',
            action: 'room_type.created',
            targetType: 'room_type',
            targetId: 'room-type-1',
            targetName: 'Double',
            details: {},
            createdAt: '2026-10-17T10:00:00.000Z',
          },
        ]),
      );
    if (url.endsWith('/room-categories') && init?.method === 'POST')
      return new Response(JSON.stringify({ id: 'category-2' }), { status: 201 });
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
            effectiveRules: 'No smoking in this room type.',
            rulesSource: 'room-type',
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
    expect(document.body.textContent).toContain('Using room type rules');
    expect(document.body.textContent).toContain('No smoking in this room type.');
    await act(async () => root.unmount());
  });

  it('switches a room from inherited house rules to an own override and back', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(RoomEditorDialog, {
          roomType: {
            id: 'room-type-1',
            name: 'Double',
            description: null,
            amenitiesIntro: null,
            rules: 'No smoking in this room type.',
            mainImageUrl: null,
            galleryImageUrls: [],
            maxOccupancy: 2,
            status: 'PUBLISHED',
          },
          room: null,
          canManageAccommodations: true,
          open: true,
          saving: false,
          onOpenChange: vi.fn(),
          onSave: vi.fn(),
        }),
      ),
    );

    expect(document.body.textContent).toContain('Shown to guests on the booking page');
    expect(document.body.textContent).toContain(
      'Using room type rules: No smoking in this room type.',
    );
    const writeOwn = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'Write rules for this room only',
    );
    await act(async () => (writeOwn as HTMLButtonElement).click());
    const textarea = document.body.querySelector('#physical-room-rules');
    expect(textarea).not.toBeNull();

    const useType = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'Use room type rules',
    );
    await act(async () => (useType as HTMLButtonElement).click());
    expect(document.body.textContent).toContain(
      'Using room type rules: No smoking in this room type.',
    );
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
      const control = document.body.querySelector<HTMLElement>(
        '[role="combobox"][aria-label="Amenities"]',
      );
      if (!control) throw new Error('Amenity selector has not opened yet.');
      control.click();
    });
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
      rules: 'No smoking in this room type.',
      maxOccupancy: 2,
      categoryId: 'category-1',
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

  it('shows server readiness and accommodation activity with a working first-fix action', async () => {
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
            canManagePhotos: true,
          }),
        ),
      ),
    );
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Hotel Owner'))
          throw new Error('Setup or activity information has not finished loading.');
      });
    });
    expect(container.textContent).toContain('Setup readiness');
    expect(container.textContent).toContain('2 missing');
    expect(container.textContent).toContain('Created Double');

    const fix = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Add details',
    );
    expect(fix).toBeDefined();
    await act(async () => (fix as HTMLButtonElement).click());
    expect(document.body.textContent).toContain('Edit room type');
    await act(async () => root.unmount());
  });

  it('opens the Categories tab with counts, ordering and storefront visibility controls', async () => {
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

    const categoriesTab = [...container.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent?.trim() === 'Categories1',
    );
    expect(categoriesTab).toBeDefined();
    await act(async () => (categoriesTab as HTMLElement).click());
    expect(container.textContent).toContain('Room categories');
    expect(container.textContent).toContain('Suites');
    expect(container.textContent).toContain('1 room types');
    expect(
      container.querySelector('[role="switch"][aria-label="Suites visible in storefront"]'),
    ).not.toBeNull();
    expect(container.querySelector('button[aria-label="Move Suites up"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
});
