import { createHash } from 'node:crypto';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';

/** What is remembered for one room type and one stay: a price, or "nothing available" for a short while. */
export type StoredDisplayPrice = {
  /** The lowest available price Clock gave, or null when Clock had nothing available for the stay. */
  value: { amount: string; currency: string } | null;
  /** The winning rate's price before its included discount; absent in older entries. */
  originalTotal?: { amount: string; currency: string };
  /** When Clock last answered, in milliseconds since 1970. */
  storedAt: number;
  /** How many rooms of this type were free, when Clock said. */
  freeRooms?: number | null;
  /** Why nothing was available (sold out, closed, ...), when the value is null. */
  reason?: string;
};

const PREFIX = 'display-price:v1:';

/**
 * The second memory for the prices shown on the website's room cards. It lives in Redis, so it survives a
 * restart or a deploy and is shared by every copy of the API; without it every deploy would start with an empty
 * memory and the first guests would wait for Clock. It is only ever a convenience: when Redis is missing or
 * slow, every call quietly does nothing and the price is simply asked from Clock as before.
 */
@Injectable()
export class DisplayPriceStore implements OnModuleDestroy {
  private readonly logger = new Logger(DisplayPriceStore.name);
  private client: IORedis | null | undefined;

  private redis(): IORedis | null {
    if (this.client !== undefined) return this.client;
    const url = process.env.REDIS_URL;
    if (!url) {
      this.client = null;
      return null;
    }
    this.client = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
    });
    this.client.on('error', () => {
      /* A missing Redis only means no second memory; the first memory and Clock still work. */
    });
    return this.client;
  }

  private key(raw: string): string {
    return PREFIX + createHash('sha256').update(raw).digest('hex');
  }

  async get(raw: string): Promise<StoredDisplayPrice | null> {
    const redis = this.redis();
    if (!redis) return null;
    try {
      if (redis.status === 'wait') await redis.connect();
      const text = await redis.get(this.key(raw));
      if (!text) return null;
      const parsed = JSON.parse(text) as StoredDisplayPrice;
      return typeof parsed.storedAt === 'number' ? parsed : null;
    } catch {
      return null;
    }
  }

  async set(raw: string, entry: StoredDisplayPrice, keepSeconds: number): Promise<void> {
    const redis = this.redis();
    if (!redis) return;
    try {
      if (redis.status === 'wait') await redis.connect();
      await redis.set(this.key(raw), JSON.stringify(entry), 'EX', keepSeconds);
    } catch (error) {
      this.logger.debug(
        `Could not store a display price: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit().catch(() => undefined);
  }
}
