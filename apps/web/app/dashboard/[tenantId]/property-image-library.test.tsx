// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { PropertyImageLibraryDialog, validateImageFile } from './property-image-library';
import { DashboardQueryProvider } from '../query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const libraryUrl = '/api/tenants/tenant-1/properties/property-1/image-library';
const images = [
  { id: 'img-1', url: 'https://cdn.test/a.jpg', originalName: 'a.jpg', usageCount: 0 },
  { id: 'img-2', url: 'https://cdn.test/b.jpg', originalName: 'b.jpg', usageCount: 2 },
  { id: 'img-3', url: 'https://cdn.test/c.jpg', originalName: null, usageCount: 0 },
];

afterEach(() => {
  vi.unstubAllGlobals();
  toast.success.mockReset();
  toast.error.mockReset();
  document.body.replaceChildren();
});

function stubFetch(handler?: (url: string, init?: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const custom = handler?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url === libraryUrl && (!init || !init.method))
      return Promise.resolve(new Response(JSON.stringify(images)));
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
}

async function mount(props: Partial<Parameters<typeof PropertyImageLibraryDialog>[0]> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(PropertyImageLibraryDialog, {
          tenantId: 'tenant-1',
          propertyId: 'property-1',
          mode: 'multi',
          title: 'Add photos from the library',
          onClose: vi.fn(),
          ...props,
        }),
      ),
    );
  });
  await settle();
  return { container, root };
}

function tileButtons(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('article > button'));
}

describe('PropertyImageLibraryDialog', () => {
  it('lets several library photos be selected and confirms their ids', async () => {
    stubFetch();
    const onConfirm = vi.fn();
    const { container, root } = await mount({ onConfirm });

    expect(tileButtons(container)).toHaveLength(3);
    await act(async () => tileButtons(container)[0].click());
    await act(async () => tileButtons(container)[2].click());
    const confirm = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.startsWith('Add 2'),
    )!;
    await act(async () => confirm.click());

    expect(onConfirm).toHaveBeenCalledWith(['img-1', 'img-3']);
    await act(async () => root.unmount());
  });

  it('single mode keeps exactly one photo selected', async () => {
    stubFetch();
    const onConfirm = vi.fn();
    const { container, root } = await mount({ mode: 'single', onConfirm });

    await act(async () => tileButtons(container)[0].click());
    await act(async () => tileButtons(container)[1].click());
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Use this photo',
    )!;
    await act(async () => confirm.click());

    expect(onConfirm).toHaveBeenCalledWith(['img-2']);
    await act(async () => root.unmount());
  });

  it('does not allow a photo that is already in the room to be selected again', async () => {
    stubFetch();
    const { container, root } = await mount({ attachedUrls: new Set(['https://cdn.test/a.jpg']) });

    expect(tileButtons(container)[0].disabled).toBe(true);
    expect(tileButtons(container)[1].disabled).toBe(false);
    expect(container.textContent).toContain('Added');
    await act(async () => root.unmount());
  });

  it('manage mode deletes a photo only after confirmation and explains when it is in use', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url === `${libraryUrl}/img-2` && init?.method === 'DELETE')
        return new Response(JSON.stringify({ message: 'This photo is used by a room type.' }), {
          status: 409,
        });
      return undefined;
    });
    const { container, root } = await mount({ mode: 'manage' });

    expect(container.textContent).toContain('Used by 2 rooms');
    const deleteButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Delete library photo"]'),
    );
    await act(async () => deleteButtons[1].click());
    expect(fetchMock).not.toHaveBeenCalledWith(`${libraryUrl}/img-2`, expect.anything());

    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Delete',
    )!;
    await act(async () => confirm.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      `${libraryUrl}/img-2`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(toast.error).toHaveBeenCalledWith('This photo is used by a room type.');
    await act(async () => root.unmount());
  });
});

describe('validateImageFile', () => {
  it('accepts JPG, PNG and WebP up to 10 MB only', () => {
    expect(validateImageFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBeNull();
    expect(validateImageFile(new File(['x'], 'a.gif', { type: 'image/gif' }))).toContain(
      'not a supported image',
    );
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    expect(validateImageFile(big)).toContain('10 MB');
  });
});
