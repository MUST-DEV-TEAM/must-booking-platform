// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { downloadCsv } from './download-csv';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('downloads the authorized filename and releases the temporary object URL even after a click failure', () => {
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:authorized-csv'),
    revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    expect(this.download).toBe('email-deliveries.csv');
    expect(this.href).toBe('blob:authorized-csv');
  });
  downloadCsv({ csv: '\uFEFF"Recorded data"', filename: 'email-deliveries.csv' });
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect(revoke).toHaveBeenCalledWith('blob:authorized-csv');
  click.mockImplementation(() => {
    throw new Error('Download blocked');
  });
  expect(() => downloadCsv({ csv: 'same evidence', filename: 'email-deliveries.csv' })).toThrow(
    'Download blocked',
  );
  expect(revoke).toHaveBeenCalledTimes(2);
});
