import { afterEach, describe, expect, it } from 'vitest';

import { DisplayPriceStore } from './display-price-store';

const original = process.env.REDIS_URL;

afterEach(() => {
  process.env.REDIS_URL = original;
});

describe('DisplayPriceStore', () => {
  it('remembers a price and a "nothing available" answer, and returns null for what it never saw', async () => {
    process.env.REDIS_URL = original ?? 'redis://localhost:6379';
    const store = new DisplayPriceStore();
    const key = `spec-${Date.now()}-${Math.random()}`;
    try {
      expect(await store.get(key)).toBeNull();
      await store.set(key, { value: { amount: '110.00', currency: 'EUR' }, storedAt: 1234 }, 60);
      expect(await store.get(key)).toEqual({
        value: { amount: '110.00', currency: 'EUR' },
        storedAt: 1234,
      });
      await store.set(`${key}-none`, { value: null, storedAt: 5678 }, 60);
      expect(await store.get(`${key}-none`)).toEqual({ value: null, storedAt: 5678 });
    } finally {
      await store.onModuleDestroy();
    }
  });

  it('quietly does nothing when there is no Redis to talk to', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    const store = new DisplayPriceStore();
    try {
      await expect(
        store.set('k', { value: { amount: '1.00', currency: 'EUR' }, storedAt: 1 }, 60),
      ).resolves.toBeUndefined();
      await expect(store.get('k')).resolves.toBeNull();
    } finally {
      await store.onModuleDestroy();
    }
  });
});
