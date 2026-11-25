import { describe, expect, it, vi } from 'vitest';

import { checkTermsAcceptance, recordTermsAcceptance } from './terms-acceptance';

const scope = { tenantId: 't1', propertyId: 'p1' };

function txWith(queries: unknown[][]) {
  const rest = [...queries];
  return {
    $queryRaw: vi.fn(async () => rest.shift() ?? []),
    $executeRaw: vi.fn(async () => 1),
  };
}

describe('terms acceptance (G-56)', () => {
  it('asks for nothing from a hotel with no links', async () => {
    const tx = txWith([[{ termsUrl: null, privacyUrl: null, required: true }]]);
    expect(await checkTermsAcceptance(tx as never, scope, false)).toEqual({
      ok: true,
      record: null,
    });
  });

  it('keeps old websites working: no requirement, no answer, nothing recorded', async () => {
    const tx = txWith([[{ termsUrl: 'https://h.test/terms', privacyUrl: null, required: false }]]);
    expect(await checkTermsAcceptance(tx as never, scope, false)).toEqual({
      ok: true,
      record: null,
    });
  });

  it('refuses a booking without acceptance when the hotel requires it', async () => {
    const tx = txWith([[{ termsUrl: 'https://h.test/terms', privacyUrl: null, required: true }]]);
    const result = await checkTermsAcceptance(tx as never, scope, false);
    expect(result).toMatchObject({ ok: false, code: 'TERMS_NOT_ACCEPTED' });
  });

  it('records the current versions when the guest accepted', async () => {
    const tx = txWith([
      [{ termsUrl: 'https://h.test/terms', privacyUrl: 'https://h.test/privacy', required: true }],
      [{ id: 'terms-v3', url: 'https://h.test/terms' }],
      [{ id: 'privacy-v1', url: 'https://h.test/privacy' }],
    ]);
    expect(await checkTermsAcceptance(tx as never, scope, true)).toEqual({
      ok: true,
      record: { termsVersionId: 'terms-v3', privacyVersionId: 'privacy-v1' },
    });
  });

  it('makes a version for a link saved before versions existed', async () => {
    const tx = txWith([
      [{ termsUrl: 'https://h.test/terms', privacyUrl: null, required: false }],
      [],
      [{ id: 'terms-v1' }],
    ]);
    expect(await checkTermsAcceptance(tx as never, scope, true)).toEqual({
      ok: true,
      record: { termsVersionId: 'terms-v1', privacyVersionId: null },
    });
  });

  it('stores nothing when there is nothing to record', async () => {
    const tx = txWith([]);
    await recordTermsAcceptance(tx as never, scope, ['b1'], null);
    await recordTermsAcceptance(tx as never, scope, [], {
      termsVersionId: 'x',
      privacyVersionId: null,
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    await recordTermsAcceptance(tx as never, scope, ['b1'], {
      termsVersionId: 'x',
      privacyVersionId: null,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
