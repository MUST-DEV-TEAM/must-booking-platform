import { createClient } from 'redis';

export async function clearSignupRateLimits(): Promise<void> {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  try {
    for await (const keys of redis.scanIterator({ MATCH: 'rate-limit:signup:*' })) {
      if (keys.length > 0) await redis.del(keys);
    }
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}
