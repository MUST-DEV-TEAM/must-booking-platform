// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('./property-image-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./property-image-library')>();
  return { ...actual, checkImageFiles: vi.fn(async () => null) };
});

import { DashboardQueryProvider } from '../query-provider';
import { RoomTypePhotoGallery, type RoomTypeImage } from './room-type-photo-gallery';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = '/api/tenants/tenant-1/properties/property-1';
const twoImages: RoomTypeImage[] = [
  { id: 'image-1', url: 'https://images.example.test/one.jpg', sortOrder: 0, isPrimary: true },
  { id: 'image-2', url: 'https://images.example.test/two.jpg', sortOrder: 1, isPrimary: false },
];

function responseFor(status = 200, body: unknown = {}) {
  return status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
}

async function renderGallery(
  images: RoomTypeImage[],
  fetchMock: ReturnType<typeof vi.fn>,
  roomId?: string,
  inheritedImages: RoomTypeImage[] = [],
) {
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(RoomTypePhotoGallery, {
          tenantId: 'tenant-1',
          propertyId: 'property-1',
          roomTypeId: roomId ? undefined : 'room-type-1',
          roomId,
          images,
          inheritedImages,
          photoSource: roomId
            ? inheritedImages.length
              ? 'room_type'
              : images.length
                ? 'room'
                : 'none'
            : undefined,
        }),
      ),
    );
  });
  return { container, root };
}

async function click(container: HTMLElement, name: string | RegExp) {
  const buttons = [...container.querySelectorAll('button')];
  const button = buttons.find((candidate) => {
    const label = candidate.getAttribute('aria-label') ?? candidate.textContent ?? '';
    return typeof name === 'string'
      ? label === name || candidate.textContent?.trim() === name
      : name.test(label);
  });
  if (!button) throw new Error(`Button not found: ${String(name)}`);
  await act(async () => button.click());
}

async function chooseFile(container: HTMLElement) {
  const fileInput = container.querySelector<HTMLInputElement>(
    'input[aria-label="Choose room photos"]',
  );
  if (!fileInput) throw new Error('Room photo file input was not rendered.');
  const file = new File([new Uint8Array([1, 2, 3])], 'room.png', { type: 'image/png' });
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
  await act(async () => {
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => expect(container.textContent).toContain('1 photo selected'));
  return file;
}

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:room-preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('RoomTypePhotoGallery', () => {
  it('uploads selected files through the existing signed upload route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/images'))
        return responseFor(201, {
          id: 'uploaded-image',
          uploadUrl: 'https://upload.example.test/file',
        });
      if (url === 'https://upload.example.test/file') return responseFor(200);
      throw new Error(`Unexpected request to ${url}`);
    });
    const { container, root } = await renderGallery([], fetchMock);
    await chooseFile(container);
    await click(container, 'Upload 1 photo');
    await act(async () =>
      vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 photo uploaded.')),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/room-types/room-type-1/images`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.example.test/file',
      expect.objectContaining({ method: 'PUT' }),
    );
    await act(async () => root.unmount());
  });

  it('keeps the staged photo and reports an authorization failure', async () => {
    const fetchMock = vi.fn(async () => responseFor(500, { message: 'Internal server error' }));
    const { container, root } = await renderGallery([], fetchMock);
    await chooseFile(container);
    await click(container, 'Upload 1 photo');
    await act(async () =>
      vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('room.png: Internal server error')),
    );

    expect(container.textContent).toContain('1 photo selected');
    expect(container.textContent).toContain('room.png');
    await act(async () => root.unmount());
  });

  it('adds a photo by URL', async () => {
    const fetchMock = vi.fn(async () => responseFor(201));
    const { container, root } = await renderGallery([], fetchMock);
    const details = container.querySelector('details');
    await act(async () =>
      details?.querySelector('summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    const input = container.querySelector<HTMLInputElement>('input[type="url"]');
    if (!input) throw new Error('Photo URL input was not rendered.');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'https://images.example.test/new.jpg');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector('details form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await act(async () =>
      vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Photo added.')),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/room-types/room-type-1/images/from-url`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://images.example.test/new.jpg' }),
      }),
    );
    await act(async () => root.unmount());
  });

  it('attaches a selected property library image', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/image-library'))
        return responseFor(200, [
          {
            id: 'library-1',
            url: 'https://images.example.test/library.jpg',
            originalName: 'library.jpg',
            usageCount: 0,
          },
        ]);
      if (url.endsWith('/images/from-library')) return responseFor(201, { added: 1 });
      throw new Error(`Unexpected request to ${url}`);
    });
    const { container, root } = await renderGallery([], fetchMock);
    await click(container, /Choose from library/);
    await act(async () =>
      vi.waitFor(() => expect(container.textContent).toContain('1 photo in library')),
    );
    const libraryButton = [...container.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label')?.startsWith('Library photo 1'),
    );
    if (!libraryButton) throw new Error('Library photo option was not rendered.');
    await act(async () => libraryButton.click());
    const addButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Add 1 photo',
    );
    if (!addButton) throw new Error('Add photo confirmation was not rendered.');
    await act(async () => addButton.click());
    await act(async () =>
      vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 photo added.')),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/room-types/room-type-1/images/from-library`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ libraryImageIds: ['library-1'] }),
      }),
    );
    await act(async () => root.unmount());
  });

  it('reorders photos with the complete ordered ID list', async () => {
    const fetchMock = vi.fn(async () => responseFor(200));
    const { container, root } = await renderGallery(twoImages, fetchMock);
    await click(container, 'Move photo 1 right');
    await act(async () =>
      vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `${base}/room-types/room-type-1/images/order`,
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ imageIds: ['image-2', 'image-1'] }),
          }),
        ),
      ),
    );
    await act(async () => root.unmount());
  });

  it('selects a primary photo', async () => {
    const fetchMock = vi.fn(async () => responseFor(200));
    const { container, root } = await renderGallery(twoImages, fetchMock);
    await click(container, 'Set photo 2 as primary photo');
    await act(async () =>
      vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `${base}/room-types/room-type-1/images/primary`,
          expect.objectContaining({ method: 'PUT', body: JSON.stringify({ imageId: 'image-2' }) }),
        ),
      ),
    );
    await act(async () => root.unmount());
  });

  it('deletes a photo only after the inline confirmation', async () => {
    const fetchMock = vi.fn(async () => responseFor(204));
    const { container, root } = await renderGallery(twoImages, fetchMock);
    await click(container, 'Remove photo 1');
    expect(container.textContent).toContain('Remove this photo?');
    expect(fetchMock).not.toHaveBeenCalled();
    await click(container, 'Remove');
    await act(async () =>
      vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `${base}/room-types/room-type-1/images/image-1`,
          expect.objectContaining({ method: 'DELETE' }),
        ),
      ),
    );
    await act(async () => root.unmount());
  });

  it('targets room image routes and labels inherited room type photos', async () => {
    const fetchMock = vi.fn(async () => responseFor(200));
    const { container, root } = await renderGallery([], fetchMock, 'room-1', [twoImages[0]]);
    expect(container.textContent).toContain('Using room type photos');
    expect(container.querySelector('[aria-label="Room type photos in use"] img')).not.toBeNull();
    await chooseFile(container);
    await click(container, 'Upload 1 photo');
    await act(async () => vi.waitFor(() => expect(fetchMock).toHaveBeenCalled()));
    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/rooms/room-1/images`,
      expect.objectContaining({ method: 'POST' }),
    );
    await act(async () => root.unmount());
  });
});
