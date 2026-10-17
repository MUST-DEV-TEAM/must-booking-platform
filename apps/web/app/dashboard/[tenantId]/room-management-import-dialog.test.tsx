// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoomManagementImportDialog } from './room-management-import-dialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

describe('RoomManagementImportDialog', () => {
  it('previews rows on the server and confirms only after review', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            kind: 'room-types',
            rows: [{ rowNumber: 2, action: 'create', target: 'Suite', errors: [] }],
            summary: { create: 1, update: 0, errors: 0 },
            canConfirm: true,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ create: 1, update: 0, errors: 0 })));
    vi.stubGlobal('fetch', fetch);
    const onImported = vi.fn();
    const onOpenChange = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    const rows = [{ name: 'Suite', maxOccupancy: '2' }];

    await act(async () =>
      root.render(
        createElement(RoomManagementImportDialog, {
          tenantId: 'tenant-1',
          propertyId: 'property-1',
          kind: 'room-types',
          rows,
          onOpenChange,
          onImported,
        }),
      ),
    );
    await act(async () => {
      await vi.waitFor(() => {
        if (!document.body.textContent?.includes('Suite')) throw new Error('Preview is loading.');
      });
    });

    expect(document.body.textContent).toContain('1 to create');
    const importButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Import 1 rows'),
    );
    expect(importButton?.disabled).toBe(false);
    await act(async () => importButton?.click());

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain('/accommodations/import/preview');
    expect(String(fetch.mock.calls[1][0])).toContain('/accommodations/import/confirm');
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ kind: 'room-types', rows });
    expect(onImported).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await act(async () => root.unmount());
  });
});
