// The Clock sandbox account is shared (CI, the live Must Hotel demo property, live checks)
// and allows only 5 requests per second, so any call can come back as `clock_rate_limited`.
// A cleanup cancel that gives up on that leaves a real reservation behind, which then
// occupies the same nights for the next run. Retry after a pause instead.
export async function retryOnClockRateLimit<T extends { ok: boolean }>(
  call: () => Promise<T>,
  attempts = 6,
  delayMs = 1_500,
): Promise<T> {
  let result = await call();
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    const code = (result as { error?: { code?: string } }).error?.code;
    if (result.ok || code !== 'clock_rate_limited') break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    result = await call();
  }
  return result;
}
