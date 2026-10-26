import { reportRequest } from './report-presentation';
/** Retains a key for retries of the same uncertain mutation. */
export function createReportWriter() {
  const keys = new Map<string, string>();
  return async function write<T>(
    url: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const signature = JSON.stringify([url, method, body]);
    let key = keys.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      keys.set(signature, key);
    }
    const result = await reportRequest<T>(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
    keys.delete(signature);
    return result;
  };
}
