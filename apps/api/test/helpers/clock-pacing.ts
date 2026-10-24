import { ClockHttpClient } from '../../src/integrations/clock/clock-http-client';

// The real Clock sandbox account is shared (CI, the live Must Hotel demo property, live
// checks) and allows 5 requests per second. The e2e app also runs background Clock work,
// so bursts exceed that and Clock answers 429, which fails a test or, worse, a cleanup
// cancel that then leaves a real reservation behind. Space the requests out and retry a
// 429 (Clock rejects those without processing them, so a retry cannot double-book).
const MIN_GAP_MS = 250;
const RETRY_DELAY_MS = 1_200;
const MAX_ATTEMPTS = 6;

let installed = false;

export function paceClockRequests(): void {
  if (installed) return;
  installed = true;
  const original = ClockHttpClient.prototype.request;
  let queue: Promise<void> = Promise.resolve();
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  ClockHttpClient.prototype.request = async function paced(this: ClockHttpClient, ...args) {
    const turn = queue.then(() => sleep(MIN_GAP_MS));
    queue = turn;
    await turn;
    let response = await original.apply(this, args);
    for (let attempt = 1; attempt < MAX_ATTEMPTS && response.status === 429; attempt += 1) {
      await sleep(RETRY_DELAY_MS);
      response = await original.apply(this, args);
    }
    return response;
  } as typeof original;
}
