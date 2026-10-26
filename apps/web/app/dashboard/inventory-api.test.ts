import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInventoryWriter, inventoryRequest } from './inventory-api';
afterEach(() => vi.unstubAllGlobals());
describe('Inventory HTTP operations', () => {
  it('retains the idempotency key across an uncertain response and changes it for a new request', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue(new Response(JSON.stringify({ id: 'r' })));
    vi.stubGlobal('fetch', fetch);
    const write = createInventoryWriter();
    await expect(write('/inventory', 'POST', { name: 'A' })).rejects.toThrow('connection lost');
    await write('/inventory', 'POST', { name: 'A' });
    const first = fetch.mock.calls[0][1].headers['Idempotency-Key'];
    expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe(first);
    fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'r2' })));
    await write('/inventory', 'POST', { name: 'B' });
    expect(fetch.mock.calls[2][1].headers['Idempotency-Key']).not.toBe(first);
  });
  it('reports version/conflict errors and never treats them as a saved response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: 'Reload before saving',
            conflicts: [{ id: 'b', reference: 'BLK-2035-0001' }],
          }),
          { status: 409 },
        ),
      ),
    );
    await expect(inventoryRequest('/inventory')).rejects.toThrow(
      'Reload before saving Conflicts: BLK-2035-0001',
    );
  });
});
