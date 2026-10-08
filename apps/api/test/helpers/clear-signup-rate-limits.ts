import { createClient } from 'redis';

async function clearKeys(pattern: string): Promise<void> {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  try {
    for await (const keys of redis.scanIterator({ MATCH: pattern })) {
      if (keys.length > 0) await redis.del(keys);
    }
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}

export async function clearSignupRateLimits(): Promise<void> {
  await clearKeys('rate-limit:signup:*');
}

/** Login-failure and auth-email request counters (keyed by email). */
export async function clearAuthRateLimits(): Promise<void> {
  await clearKeys('rate-limit:auth:*');
}
