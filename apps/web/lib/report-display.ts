/** Plain explanations for missing recorded fields; never substitute zero or current prices. */
export function reportMissingReason(key: string, source = 'LOCAL') {
  if (/available|occupancy|revpar|blocked|soldOut|lowAvailability/i.test(key))
    return source === 'CLOCK' ? 'Managed in Clock' : 'Historical capacity not recorded';
  if (/revenue|amount|adr|charges|spend/i.test(key)) return 'Nightly price not recorded';
  if (/cancel|freeWindow/i.test(key)) return 'Cancellation details not recorded';
  if (key === 'room') return 'No individual room assigned';
  if (key === 'currency') return 'No priced stay in this group';
  if (key === 'href') return 'No accessible record link';
  return 'Not recorded';
}
/** Hide unavailable aggregate fields and repetitive definitions while preserving known zero/false. */
export function reportDisplayEvidence(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (value === 'Unknown') return 'Not recorded';
  if (Array.isArray(value)) return value.map(reportDisplayEvidence).filter((v) => v !== undefined);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (
      Array.isArray(record.pickup) &&
      record.pickup.length &&
      record.pickup.every(
        (v) =>
          v && typeof v === 'object' && (v as Record<string, unknown>).status === 'No history yet',
      ) &&
      record.pace &&
      typeof record.pace === 'object' &&
      (record.pace as Record<string, unknown>).status === 'No history yet'
    )
      return { status: 'Daily history is still accumulating; no earlier snapshot for these dates' };
    if (record.status === 'No history yet')
      return { status: 'No earlier daily snapshot for these dates' };
    const result = Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !/basis$/i.test(key))
        .map(([key, v]) => [key, reportDisplayEvidence(v)])
        .filter(([, v]) => v !== undefined),
    );
    return Object.keys(result).length ? result : undefined;
  }
  return value;
}
