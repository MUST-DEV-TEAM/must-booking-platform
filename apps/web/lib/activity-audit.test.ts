import { afterEach, expect, it, vi } from 'vitest';
import { auditPage, auditRequest, createAuditExporter } from './activity-audit';
afterEach(() => vi.unstubAllGlobals());
it('rejects malformed data without invented counts or enabled export', () => {
  for (const value of [null, [], { items: [] }])
    expect(() => auditPage(value)).toThrow('Audit data is incomplete');
});
it('preserves an exact export operation key when the first response is lost', async () => {
  const calls: RequestInit[] = [];
  let fail = true;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push(init);
    if (fail) {
      fail = false;
      throw new Error('Lost response');
    }
    return Response.json({
      csv: '\uFEFFdata',
      count: 1,
      version: 1,
      evidenceId: 'event',
      filename: 'audit.csv',
    });
  });
  const exportCsv = createAuditExporter();
  await expect(exportCsv('/audit/export', { version: 0 })).rejects.toThrow('Lost response');
  await exportCsv('/audit/export', { version: 0 });
  await exportCsv('/audit/export', { version: 1 });
  expect(calls[0].headers).toEqual(calls[1].headers);
  expect(calls[1].headers).not.toEqual(calls[2].headers);
});
it('carries a server reference and permission failure rather than accepting the payload', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('{"message":"Forbidden"}', {
        status: 403,
        headers: { 'x-request-id': 'audit-ref' },
      }),
  );
  await expect(auditRequest('/audit')).rejects.toMatchObject({
    status: 403,
    reference: 'audit-ref',
    message: 'Forbidden',
  });
});
