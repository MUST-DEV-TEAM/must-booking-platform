export async function inventoryRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const conflicts = Array.isArray(data?.conflicts)
      ? data.conflicts
          .map(
            (c: { reference?: string; name?: string; id: string }) => c.reference ?? c.name ?? c.id,
          )
          .join(', ')
      : '';
    throw new Error(
      `${Array.isArray(data?.message) ? data.message.join(' ') : (data?.message ?? 'Inventory request failed.')}${conflicts ? ' Conflicts: ' + conflicts : ''}`,
    );
  }
  return data as T;
}
/** Keep the same operation key after an uncertain response; changing fields starts a new operation. */
export function createInventoryWriter() {
  const keys = new Map<string, string>();
  return async function write<T>(url: string, method: string, body: unknown): Promise<T> {
    const fingerprint = JSON.stringify({ url, method, body });
    const key = keys.get(fingerprint) ?? crypto.randomUUID();
    keys.set(fingerprint, key);
    const result = await inventoryRequest<T>(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
    keys.delete(fingerprint);
    return result;
  };
}
